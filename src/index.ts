import Data from './data';
import Logger from './logger';
import { uuid } from './utils';

enum NativeEvents {
  PLAYING = 'playing',
  ENDED = 'ended',
  PAUSE = 'pause',
}

interface Hls {
  media: HTMLMediaElement | null;
}

type BaseEventParams = {
  name: string;
  duration?: number;
  video_time?: number;
  session_id: string;
  embed_id: string;
  source_url: string;
  component?: string;
  timestamp: number;
};

export type MetricsOptions = {
  component?: string;
};

export class Metrics {
  VERSION = '__buildVersion';
  querySelectorable?: string;
  hls?: Hls;
  embedId?: string;
  component?: string;

  sessionId: string;

  #video!: HTMLVideoElement;

  #lastEventType?: null | 'play' | 'pause' = null;
  #monitoring = false;

  #wasPlayingBeforeSeek = false;
  #seekPlayTimeoutId: number | null = null;
  #awaitingSeekResumePlay = false;
  #suppressNativePlayUntilMs = 0;
  #lastObservedVideoTime = 0;
  #playbackRafId: number | null = null;

  // HLS (and some players) can briefly toggle play/pause during startup while
  // buffering/attaching media. We debounce an "early" pause right after play
  // and cancel it if playback resumes.
  #lastPlayAtMs: number | null = null;
  #pendingPauseTimeoutId: number | null = null;
  #pendingPauseParams: BaseEventParams | null = null;
  #EARLY_PAUSE_WINDOW_MS = 750;
  #EARLY_PAUSE_MAX_VIDEO_TIME_S = 1;
  #EARLY_PAUSE_DEBOUNCE_MS = 300;
  #lastPlayWasSeekResume = false;

  #onNativeEvent = (event: Event) => this.#recordEvent(event);

  #clearSeekPlayTimeout() {
    if (this.#seekPlayTimeoutId != null) {
      window.clearTimeout(this.#seekPlayTimeoutId);
      this.#seekPlayTimeoutId = null;
    }
  }

  #onSeeking = () => {
    if (!this.#monitoring) return;
    if (!this.#video) return;

    // If we're mid-scrub, keep coalescing until the final seek settles.
    this.#clearSeekPlayTimeout();

    Logger.debug("Metrics.native.seeking", {
      currentTime: this.#video.currentTime,
      lastObservedVideoTime: this.#lastObservedVideoTime,
      paused: this.#video.paused,
      seeking: (this.#video as any).seeking,
      lastEventType: this.#lastEventType,
    });

    const wasPlaying = this.#lastEventType === 'play' || (!this.#video.paused && !this.#video.ended);

    // Emit a pause as soon as the user starts scrubbing, so we close the
    // viewing interval at the old time.
    if (wasPlaying && this.#lastEventType !== 'pause') {
      this.#wasPlayingBeforeSeek = true;
      this.#awaitingSeekResumePlay = false;
      this.#clearPendingPause();
      this.#stopPlaybackSampling();

      const pauseTime = this.#lastObservedVideoTime || this.#video.currentTime || 0;
      const params = this.#baseEventParams('pause');

      Data.push({ ...params, name: 'pause', video_time: pauseTime });
      this.#lastEventType = 'pause';
      Data.flush();

      Logger.debug("Metrics.scrub.pause_sent", {
        pauseTime,
        currentTime: this.#video.currentTime,
      });
    } else {
      Logger.debug("Metrics.scrub.pause_not_sent", {
        wasPlaying,
        lastEventType: this.#lastEventType,
      });
    }
  };

  #onSeeked = () => {
    if (!this.#monitoring) return;
    if (!this.#video) return;

    Logger.debug("Metrics.native.seeked", {
      currentTime: this.#video.currentTime,
      paused: this.#video.paused,
      seeking: (this.#video as any).seeking,
      wasPlayingBeforeSeek: this.#wasPlayingBeforeSeek,
      lastEventType: this.#lastEventType,
    });

    if (!this.#wasPlayingBeforeSeek) return;

    // Debounce: during a drag, seeked can fire multiple times. Only emit
    // the play once the user settles on a final time.
    this.#clearSeekPlayTimeout();

    this.#seekPlayTimeoutId = window.setTimeout(() => {
      this.#seekPlayTimeoutId = null;
      if (!this.#monitoring) return;
      if (!this.#video) return;

      // If playback already resumed (some players may fire native `playing`
      // around seeks), don't emit a second play.
      if (this.#lastEventType === 'play') {
        this.#wasPlayingBeforeSeek = false;
        this.#awaitingSeekResumePlay = false;
        return;
      }

      // If playback already continued by the time the seek settles, emit the
      // play now. Otherwise, wait for the next native `playing`.
      if (!this.#video.seeking && !this.#video.paused && !this.#video.ended) {
        const params = this.#baseEventParams('play');
        Data.push({ ...params, name: 'play' });
        this.#lastEventType = 'play';
        this.#lastPlayAtMs = Date.now();
        this.#lastPlayWasSeekResume = true;
        this.#suppressNativePlayUntilMs = Date.now() + 1500;
        this.#startPlaybackSampling();
        this.#awaitingSeekResumePlay = false;
        Data.flush();
        this.#wasPlayingBeforeSeek = false;
      } else {
        // Some browsers/players briefly report paused at `seeked` even though
        // playback resumes a moment later. We'll emit play on the next `playing`.
        this.#awaitingSeekResumePlay = true;
        this.#wasPlayingBeforeSeek = false;
      }
    }, 200);
  };

  #onVisibilityChange = () => {
    if (!this.#monitoring) return;

    if (document.visibilityState === 'hidden') {
      // Switching tabs/windows can keep media playing. Don't emit a semantic
      // pause here; just flush any buffered events.
      Data.flush();
    }
  };

  #onPageHide = (event: PageTransitionEvent) => {
    if (!this.#monitoring) return;

    // If the page is going into the back/forward cache, it may resume later.
    // Avoid emitting a pause; just flush buffered events.
    if (event.persisted) {
      Data.flush();
      return;
    }

    // On actual navigation away / tab close, the video will stop.
    this.#flushPendingPause();
    this.#queuePauseToCloseSession();

    // Best-effort flush for page exit (prefer sendBeacon).
    Data.flushOnExit();
  };

  public constructor(
    querySelectorable: string,
    embedId: string,
    options?: MetricsOptions
  );

  public constructor(
    videoElement: HTMLMediaElement | HTMLVideoElement,
    embedId: string,
    options?: MetricsOptions
  );

  public constructor(
    hls: Hls,
    embedId: string,
    options?: MetricsOptions
  );

  public constructor(...args: Array<unknown>) {
    this.sessionId = uuid();

    if (args.length < 2) {
      Logger.error(
        'Metrics requires two arguments: a querySelectorable, hls instance or HTMLMediaElement/HTMLVideoElement and a unique embedId for your video.'
      );
    } else {
      if (typeof args[0] === 'string') {
        this.querySelectorable = args[0];
        this.embedId = args[1] as string;
      }

      if (
        args[0] instanceof HTMLVideoElement ||
        args[0] instanceof HTMLMediaElement
      ) {
        this.#video = args[0] as HTMLVideoElement;
      } else if (typeof args[0] === 'object') {
        this.hls = args[0] as Hls;
      }

      this.embedId = args[1] as string;

      if (args[2]) {
        const options = args[2] as MetricsOptions;
        this.component = options.component;
      }
    }
  }

  public static set config(config: { apiEndpoint: string; debug?: boolean }) {
    Data.config = config;

    if (typeof config.debug === "boolean") {
      Logger.setDebug(config.debug);
    }
  }

  monitor(): Metrics {
    const video = this.querySelectorable
      ? document.querySelector(this.querySelectorable)
      : this.hls?.media;

    if (this.#monitoring) return this;

    if (video || this.#video) {
      if (!this.#video) this.#video = video as HTMLVideoElement;

      Logger.debug("Metrics.monitor", {
        embed_id: this.embedId,
        session_id: this.sessionId,
        currentTime: this.#video.currentTime,
        paused: this.#video.paused,
        seeking: (this.#video as any).seeking,
        readyState: (this.#video as any).readyState,
      });
      
      this.#recordSession();
      this.#lastObservedVideoTime = this.#video.currentTime || 0;
      window.addEventListener('visibilitychange', this.#onVisibilityChange);
      window.addEventListener('pagehide', this.#onPageHide);
      this.#monitoring = true;
    } else {
      Logger.error(
        `${this.querySelectorable} is not a valid reference to a HTMLVideoElement.`
      );
    }

    return this;
  }

  demonitor(): void {
    if (!this.#monitoring) return;

    this.#flushPendingPause();
    this.#emitPauseIfPlaying();
    this.#clearSeekPlayTimeout();
    this.#stopPlaybackSampling();
    this.#unrecordSession();

    window.removeEventListener('visibilitychange', this.#onVisibilityChange);
    window.removeEventListener('pagehide', this.#onPageHide);
    this.#monitoring = false;
  }

  #baseEventParams(name: string) {
    return {
      name,
      duration: this.#video?.duration,
      video_time: this.#video?.currentTime,
      session_id: this.sessionId,
      embed_id: this.embedId || 'unknown',
      component: this.component,
      source_url: window.location.href,
      timestamp: Date.now()
    };
  }

  #emitPauseIfPlaying() {
    if (!this.#video) return;
    if (this.#video.paused) return;
    if (this.#lastEventType === 'pause') return;

    // If a pause is already queued (from a native pause), keep that one.
    if (this.#pendingPauseTimeoutId) return;

    this.#queuePauseIfNeeded();
    Data.flush();
  }

  #queuePauseIfNeeded() {
    if (!this.#video) return;
    if (this.#lastEventType === 'pause') return;

    // If a pause is already queued (from a native pause), keep that one.
    if (this.#pendingPauseTimeoutId) return;

    Data.push(this.#baseEventParams('pause'));
    this.#lastEventType = 'pause';
  }

  #queuePauseToCloseSession() {
    if (!this.#video) return;

    // On page refresh/navigation, the browser may mark the media as paused
    // before this handler runs. We still want to close an open play interval.
    if (this.#lastEventType !== 'play') return;

    // If a pause is already queued (from a native pause), don't double-send.
    if (this.#pendingPauseTimeoutId) return;

    Data.push(this.#baseEventParams('pause'));
    this.#lastEventType = 'pause';
  }

  #clearPendingPause() {
    if (this.#pendingPauseTimeoutId) {
      window.clearTimeout(this.#pendingPauseTimeoutId);
      this.#pendingPauseTimeoutId = null;
    }

    this.#pendingPauseParams = null;
  }

  #flushPendingPause() {
    if (!this.#pendingPauseTimeoutId || !this.#pendingPauseParams) return;

    window.clearTimeout(this.#pendingPauseTimeoutId);
    const params = this.#pendingPauseParams;
    this.#pendingPauseTimeoutId = null;
    this.#pendingPauseParams = null;

    Data.push(params);
    this.#lastEventType = 'pause';
    this.#lastPlayWasSeekResume = false;
    Data.flush();
  }

  #schedulePause(params: BaseEventParams) {
    if (this.#pendingPauseTimeoutId) return;

    this.#pendingPauseParams = params;
    this.#pendingPauseTimeoutId = window.setTimeout(() => {
      if (!this.#pendingPauseParams) {
        this.#pendingPauseTimeoutId = null;
        return;
      }

      const payload = this.#pendingPauseParams;
      this.#pendingPauseParams = null;
      this.#pendingPauseTimeoutId = null;

      Data.push(payload);
      this.#lastEventType = 'pause';
      Data.flush();
    }, this.#EARLY_PAUSE_DEBOUNCE_MS);
  }

  #recordSession() {
    Logger.debug("Metrics.listeners.attach", {
      embed_id: this.embedId,
      session_id: this.sessionId,
    });

    for (const event of Object.values(NativeEvents)) {
      this.#video.addEventListener(event, this.#onNativeEvent);
    }

    this.#video.addEventListener('seeking', this.#onSeeking);
    this.#video.addEventListener('seeked', this.#onSeeked);
  }

  #unrecordSession() {
    for (const event of Object.values(NativeEvents)) {
      this.#video.removeEventListener(event, this.#onNativeEvent);
    }

    this.#video.removeEventListener('seeking', this.#onSeeking);
    this.#video.removeEventListener('seeked', this.#onSeeked);
  }

  #startPlaybackSampling() {
    if (!this.#video) return;
    if (this.#playbackRafId != null) return;

    const tick = () => {
      if (!this.#video) {
        this.#playbackRafId = null;
        return;
      }

      this.#lastObservedVideoTime = this.#video.currentTime || this.#lastObservedVideoTime;

      if (this.#monitoring && !this.#video.paused && !this.#video.ended) {
        this.#playbackRafId = window.requestAnimationFrame(tick);
      } else {
        this.#playbackRafId = null;
      }
    };

    this.#playbackRafId = window.requestAnimationFrame(tick);
  }

  #stopPlaybackSampling() {
    if (this.#playbackRafId != null) {
      window.cancelAnimationFrame(this.#playbackRafId);
      this.#playbackRafId = null;
    }
  }

  #recordEvent(event: Event) {
    const params = this.#baseEventParams(event.type);

    Logger.debug("Metrics.native.event", {
      type: event.type,
      currentTime: this.#video?.currentTime,
      paused: this.#video?.paused,
      seeking: (this.#video as any)?.seeking,
      readyState: (this.#video as any)?.readyState,
      lastEventType: this.#lastEventType,
      wasPlayingBeforeSeek: this.#wasPlayingBeforeSeek,
      awaitingSeekResumePlay: this.#awaitingSeekResumePlay,
    });

    switch (event.type) {
      case NativeEvents.PLAYING:
        // If we had a debounced pause (startup glitch), cancel it when playback resumes.
        this.#clearPendingPause();

        // If we previously emitted a scrub-start pause, ensure we re-open the
        // play interval once playback actually resumes.
        if (this.#awaitingSeekResumePlay) {
          if (this.#lastEventType !== 'play') {
            const playParams = this.#baseEventParams('play');
            Data.push({ ...playParams, name: 'play' });
            this.#lastEventType = 'play';
            this.#lastPlayAtMs = Date.now();
            this.#lastPlayWasSeekResume = true;
            this.#suppressNativePlayUntilMs = Date.now() + 1500;
            this.#startPlaybackSampling();
            Data.flush();
          }

          this.#awaitingSeekResumePlay = false;
          break;
        }

        // While scrubbing we coalesce into a single pause@old + play@new.
        // Some players fire native `playing` during the drag/settle; ignore it.
        if (this.#video?.seeking || this.#wasPlayingBeforeSeek) {
          break;
        }

        // If we just emitted a play due to scrubbing, suppress the native playing.
        if (Date.now() < this.#suppressNativePlayUntilMs) {
          this.#lastEventType = 'play';
          this.#startPlaybackSampling();
          break;
        }

        if (this.#lastEventType === 'play') {
          break;
        }
        
        Data.push({ ...params, name: 'play' });
        this.#lastEventType = 'play';
        this.#lastPlayAtMs = Date.now();
        this.#lastPlayWasSeekResume = false;
        this.#startPlaybackSampling();
        break;

      case NativeEvents.PAUSE:
        // Scrubbing can trigger a native pause; suppress it if we've already
        // emitted the scrub-start pause.
        if (this.#video?.seeking) {
          this.#stopPlaybackSampling();
          break;
        }

        if (this.#lastEventType === 'pause') {
          this.#stopPlaybackSampling();
          break;
        }

        const timeSincePlayMs =
          this.#lastPlayAtMs == null ? Number.POSITIVE_INFINITY : Date.now() - this.#lastPlayAtMs;
        const videoTime = this.#video?.currentTime ?? 0;

        // Debounce an "early" pause right after play (common with HLS attach/buffer).
        // Also debounce right after a seek-resume play, where some players briefly
        // toggle pause/playing while buffering.
        if (
          timeSincePlayMs <= this.#EARLY_PAUSE_WINDOW_MS &&
            (videoTime <= this.#EARLY_PAUSE_MAX_VIDEO_TIME_S || this.#lastPlayWasSeekResume)
        ) {
          this.#schedulePause({ ...params, name: 'pause' });
          this.#stopPlaybackSampling();
          break;
        }

        Data.push({ ...params, name: 'pause' });
        this.#lastEventType = 'pause';
        this.#lastPlayWasSeekResume = false;
        this.#stopPlaybackSampling();
        Data.flush();
        break;

      case NativeEvents.ENDED:
        this.#clearPendingPause();
        this.#stopPlaybackSampling();

        if (this.#lastEventType !== 'pause') {
          Data.push({ ...params, name: 'pause' });
          this.#lastEventType = 'pause';
          Data.flush();
        }

        break;
        
      default:
         break;
    }
  }
}
