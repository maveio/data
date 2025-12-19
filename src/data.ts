import Logger from './logger';

export interface Event {
  name: string;
  timestamp: number;
  session_id: string;
  embed_id?: string;
  video_time?: number;
  duration?: number;
  source_url?: string;
  [key: string]: any;
}

export interface Config {
  apiEndpoint: string; // https://metrics.mave.io/v1/events
  debug?: boolean;
}

export default class Data {
  private static instance: Data;
  
  #config: Config = { apiEndpoint: '' };
  #buffer: Event[] = [];
  #flushInterval: ReturnType<typeof setInterval> | null = null;
  #visibilityChangeHandler: ((event?: globalThis.Event) => void) | null = null;
  #FLUSH_DELAY = 5000;
  #MAX_EVENTS_PER_BATCH = 50;
  #MAX_BYTES_PER_BATCH = 48 * 1024;
  #flushInFlight: Promise<boolean> | null = null;
  
  private constructor() {
    if (typeof window !== 'undefined') {

      const handler = this.#handleVisibilityChange.bind(this);
      this.#visibilityChangeHandler = handler;
      // 'visibilitychange' fires on document
      document.addEventListener('visibilitychange', handler);
      // 'pagehide' fires on window (end of session)
      window.addEventListener('pagehide', handler);
      // 'beforeunload' fires on window
      window.addEventListener('beforeunload', handler);
    }
  }

  public static get instance_(): Data {
    if (!Data.instance) {
      Data.instance = new Data();
    }
    return Data.instance;
  }

  public static set config(config: Config) {
    Data.instance_.#config = config;
    if (typeof config.debug === "boolean") {
      Logger.setDebug(config.debug);
    }
  }

  public static push(event: Partial<Event>) {
    Data.instance_.#push(event);
  }

  public static flush() {
    Data.instance_.#flush();
  }

  public static flushAsync(): Promise<boolean> {
    return Data.instance_.#flushAsync();
  }

  public static flushOnExit() {
    Data.instance_.#flush({ keepalive: true, preferBeacon: true });
  }

  /** @internal */
  public static __resetForTests() {
    if (Data.instance) {
      Data.instance.#teardown();
    }

    Data.instance = undefined as unknown as Data;
  }

  #push(event: Partial<Event>) {
    // Ensure essential fields
    const fullEvent: Event = {
      name: event.name || 'unknown',
      timestamp: event.timestamp || Date.now(),
      session_id: event.session_id || '',
      ...event
    };

    this.#buffer.push(fullEvent);

    Logger.debug("Data.push", {
      name: fullEvent.name,
      session_id: fullEvent.session_id,
      embed_id: fullEvent.embed_id,
      video_time: fullEvent.video_time,
      buffer_size: this.#buffer.length
    });
    
    if (!this.#flushInterval && typeof globalThis.setInterval === 'function') {
      this.#flushInterval = globalThis.setInterval(() => this.#flush(), this.#FLUSH_DELAY);
    }
    
    // If buffer reaches the batch size limit, flush immediately.
    if (this.#buffer.length >= this.#MAX_EVENTS_PER_BATCH) {
      this.#flush();
    }
  }

  #flushAsync(options?: { keepalive?: boolean; preferBeacon?: boolean }): Promise<boolean> {
    this.#flush(options);
    return this.#flushInFlight ?? Promise.resolve(true);
  }

  #flush(options?: { keepalive?: boolean; preferBeacon?: boolean }) {
    if (this.#buffer.length === 0) return;

    // If a flush is already in-flight, let it finish. The in-flight flush will
    // clear the buffer it captured; new events may still accumulate and will be
    // picked up by the next interval/explicit flush.
    if (this.#flushInFlight) return;

    const events = [...this.#buffer];
    this.#buffer = [];
    
    const url = this.#config.apiEndpoint || 'https://metrics.video-dns.com/v1/events';

    // We primarily use fetch(+keepalive) because it supports larger payloads,
    // better error handling, and lets us requeue on failure.
    // On page exit we can opportunistically use sendBeacon as a best-effort.
    const keepalive =
      options?.keepalive ??
        (typeof document !== 'undefined' && document.visibilityState === 'hidden');
    const preferBeacon = options?.preferBeacon ?? false;

    const batches = this.#chunkEvents(events);

    Logger.debug("Data.flush.start", {
      url,
      buffered: events.length,
      batches: batches.map(b => b.length),
      keepalive,
      preferBeacon
    });

    // Fire sequentially to avoid creating too many concurrent keepalive requests.
    // If new events arrive while flushing, we kick off another flush after a
    // successful send so they don't sit around until the next timer tick.
    let shouldFlushAgain = false;

    this.#flushInFlight = (async () => {
      for (const batch of batches) {
        const payload = { events: batch };

        Logger.debug("Data.flush.batch", {
          size: batch.length,
          first: batch[0]?.name,
          last: batch[batch.length - 1]?.name
        });

        const ok = await this.#send(url, payload, keepalive, preferBeacon);

        if (!ok) {
          // Put the failed batch back at the front of the buffer, preserving order.
          this.#buffer = [...batch, ...this.#buffer];
          return false;
        }
      }

      return true;
    })()
      .catch(err => {
        Logger.error('Failed to send metrics', err);
        // Requeue everything we attempted.
        this.#buffer = [...events, ...this.#buffer];
        return false;
      })
      .then(ok => {
        Logger.debug("Data.flush.done", { ok, remaining_buffer: this.#buffer.length });
        if (ok && this.#buffer.length > 0) {
          shouldFlushAgain = true;
        }

        return ok;
      })
      .finally(() => {
        this.#flushInFlight = null;

        // If we successfully drained the buffer, stop the interval to avoid
        // a forever idle timer.
        if (this.#buffer.length === 0) {
          this.#stopFlushInterval();
        }

        if (shouldFlushAgain) {
          this.#flush();
        }
      });
  }

  #stopFlushInterval() {
    if (this.#flushInterval == null) return;
    if (typeof globalThis.clearInterval === 'function') {
      globalThis.clearInterval(this.#flushInterval);
    }
    this.#flushInterval = null;
  }

  #teardown() {
    if (typeof window !== 'undefined' && this.#visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.#visibilityChangeHandler);
      window.removeEventListener('pagehide', this.#visibilityChangeHandler);
      window.removeEventListener('beforeunload', this.#visibilityChangeHandler);
    }

    this.#stopFlushInterval();
    this.#buffer = [];
    this.#flushInFlight = null;
  }

  #chunkEvents(events: Event[]): Event[][] {
    const batches: Event[][] = [];
    let current: Event[] = [];
    let currentBytes = 0;

    for (const event of events) {
      const eventBytes = this.#approxEventBytes(event);
      const wouldExceedBytes = currentBytes + eventBytes > this.#MAX_BYTES_PER_BATCH;
      const wouldExceedCount = current.length >= this.#MAX_EVENTS_PER_BATCH;

      if (current.length > 0 && (wouldExceedBytes || wouldExceedCount)) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }

      current.push(event);
      currentBytes += eventBytes;
    }

    if (current.length > 0) batches.push(current);
    return batches;
  }

  #approxEventBytes(event: Event): number {
    // Rough estimate so we can keep batches small enough for keepalive.
    // JSON.stringify cost is acceptable here since flush already serializes.
    try {
      return JSON.stringify(event).length;
    } catch {
      return 1024;
    }
  }

  async #send(url: string, payload: any, keepalive: boolean, preferBeacon: boolean): Promise<boolean> {
    if (preferBeacon && keepalive && this.#sendBeacon(url, payload)) {
      Logger.debug("Data.send.beacon", { url, bytes: JSON.stringify(payload).length });
      return true;
    }

    try {
      const res = await fetch(url, {
      method: 'POST',
      keepalive: keepalive,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
      });

      Logger.debug("Data.send.fetch", { url, ok: res.ok, status: (res as any).status });
      return res.ok;
    } catch (err) {
      Logger.error('Failed to send metrics', err);
      Logger.debug("Data.send.fetch.error", err);
      return false;
    }
  }

  #sendBeacon(url: string, payload: any): boolean {
    try {
      if (typeof navigator === 'undefined') return false;
      if (typeof navigator.sendBeacon !== 'function') return false;

      const json = JSON.stringify(payload);

      // sendBeacon is best-effort and typically limited to small payloads.
      // Keep it below our max batch size estimate.
      if (json.length > this.#MAX_BYTES_PER_BATCH) return false;

      const blob = new Blob([json], { type: 'application/json' });
      return navigator.sendBeacon(url, blob);
    } catch (_err) {
      return false;
    }
  }

  #handleVisibilityChange(event?: globalThis.Event) {
    const isUnload = event?.type === 'pagehide' || event?.type === 'beforeunload';
    const isHidden = document.visibilityState === 'hidden';
    
    if (isUnload || isHidden) {
      Logger.debug(`Data.handleVisibilityChange (${event?.type || 'visibility'})`, { state: document.visibilityState });
      this.#flush({ keepalive: true, preferBeacon: true });
    }
  }
}
