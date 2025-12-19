var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/logger.ts
var _debugEnabled;
var _Logger = class _Logger {
  static setDebug(enabled) {
    __privateSet(_Logger, _debugEnabled, enabled);
  }
  static debugEnabled() {
    if (__privateGet(_Logger, _debugEnabled)) return true;
    try {
      const anyGlobal = globalThis;
      if (anyGlobal.__MAVE_DATA_DEBUG__ === true) return true;
      if (anyGlobal.localStorage?.getItem("MAVE_DATA_DEBUG") === "1") return true;
    } catch {
    }
    return false;
  }
  static log(message) {
    console.log(`[mave_data]: ${message}`);
  }
  static error(message, meta) {
    if (typeof meta === "undefined") {
      console.error(`[mave_data]: ${message}`);
    } else {
      console.error(`[mave_data]: ${message}`, meta);
    }
  }
  static debug(message, meta) {
    if (!_Logger.debugEnabled()) return;
    if (typeof meta === "undefined") {
      console.debug(`[mave_data]: ${message}`);
    } else {
      console.debug(`[mave_data]: ${message}`, meta);
    }
  }
};
_debugEnabled = new WeakMap();
__privateAdd(_Logger, _debugEnabled, false);
var Logger = _Logger;

// src/data.ts
var _config, _buffer, _flushInterval, _visibilityChangeHandler, _FLUSH_DELAY, _MAX_EVENTS_PER_BATCH, _MAX_BYTES_PER_BATCH, _flushInFlight, _Data_instances, push_fn, flushAsync_fn, flush_fn, stopFlushInterval_fn, teardown_fn, chunkEvents_fn, approxEventBytes_fn, send_fn, sendBeacon_fn, handleVisibilityChange_fn;
var _Data = class _Data {
  constructor() {
    __privateAdd(this, _Data_instances);
    __privateAdd(this, _config, { apiEndpoint: "" });
    __privateAdd(this, _buffer, []);
    __privateAdd(this, _flushInterval, null);
    __privateAdd(this, _visibilityChangeHandler, null);
    __privateAdd(this, _FLUSH_DELAY, 5e3);
    __privateAdd(this, _MAX_EVENTS_PER_BATCH, 50);
    __privateAdd(this, _MAX_BYTES_PER_BATCH, 48 * 1024);
    __privateAdd(this, _flushInFlight, null);
    if (typeof window !== "undefined") {
      const handler = __privateMethod(this, _Data_instances, handleVisibilityChange_fn).bind(this);
      __privateSet(this, _visibilityChangeHandler, handler);
      document.addEventListener("visibilitychange", handler);
      window.addEventListener("pagehide", handler);
      window.addEventListener("beforeunload", handler);
    }
  }
  static get instance_() {
    if (!_Data.instance) {
      _Data.instance = new _Data();
    }
    return _Data.instance;
  }
  static set config(config) {
    __privateSet(_Data.instance_, _config, config);
    if (typeof config.debug === "boolean") {
      Logger.setDebug(config.debug);
    }
  }
  static push(event) {
    var _a;
    __privateMethod(_a = _Data.instance_, _Data_instances, push_fn).call(_a, event);
  }
  static flush() {
    var _a;
    __privateMethod(_a = _Data.instance_, _Data_instances, flush_fn).call(_a);
  }
  static flushAsync() {
    var _a;
    return __privateMethod(_a = _Data.instance_, _Data_instances, flushAsync_fn).call(_a);
  }
  static flushOnExit() {
    var _a;
    __privateMethod(_a = _Data.instance_, _Data_instances, flush_fn).call(_a, { keepalive: true, preferBeacon: true });
  }
  /** @internal */
  static __resetForTests() {
    var _a;
    if (_Data.instance) {
      __privateMethod(_a = _Data.instance, _Data_instances, teardown_fn).call(_a);
    }
    _Data.instance = void 0;
  }
};
_config = new WeakMap();
_buffer = new WeakMap();
_flushInterval = new WeakMap();
_visibilityChangeHandler = new WeakMap();
_FLUSH_DELAY = new WeakMap();
_MAX_EVENTS_PER_BATCH = new WeakMap();
_MAX_BYTES_PER_BATCH = new WeakMap();
_flushInFlight = new WeakMap();
_Data_instances = new WeakSet();
push_fn = function(event) {
  const fullEvent = {
    name: event.name || "unknown",
    timestamp: event.timestamp || Date.now(),
    session_id: event.session_id || "",
    ...event
  };
  __privateGet(this, _buffer).push(fullEvent);
  Logger.debug("Data.push", {
    name: fullEvent.name,
    session_id: fullEvent.session_id,
    embed_id: fullEvent.embed_id,
    video_time: fullEvent.video_time,
    buffer_size: __privateGet(this, _buffer).length
  });
  if (!__privateGet(this, _flushInterval) && typeof globalThis.setInterval === "function") {
    __privateSet(this, _flushInterval, globalThis.setInterval(() => __privateMethod(this, _Data_instances, flush_fn).call(this), __privateGet(this, _FLUSH_DELAY)));
  }
  if (__privateGet(this, _buffer).length >= __privateGet(this, _MAX_EVENTS_PER_BATCH)) {
    __privateMethod(this, _Data_instances, flush_fn).call(this);
  }
};
flushAsync_fn = function(options) {
  __privateMethod(this, _Data_instances, flush_fn).call(this, options);
  return __privateGet(this, _flushInFlight) ?? Promise.resolve(true);
};
flush_fn = function(options) {
  if (__privateGet(this, _buffer).length === 0) return;
  if (__privateGet(this, _flushInFlight)) return;
  const events = [...__privateGet(this, _buffer)];
  __privateSet(this, _buffer, []);
  const url = __privateGet(this, _config).apiEndpoint || "https://metrics.video-dns.com/v1/events";
  const keepalive = options?.keepalive ?? (typeof document !== "undefined" && document.visibilityState === "hidden");
  const preferBeacon = options?.preferBeacon ?? false;
  const batches = __privateMethod(this, _Data_instances, chunkEvents_fn).call(this, events);
  Logger.debug("Data.flush.start", {
    url,
    buffered: events.length,
    batches: batches.map((b) => b.length),
    keepalive,
    preferBeacon
  });
  let shouldFlushAgain = false;
  __privateSet(this, _flushInFlight, (async () => {
    for (const batch of batches) {
      const payload = { events: batch };
      Logger.debug("Data.flush.batch", {
        size: batch.length,
        first: batch[0]?.name,
        last: batch[batch.length - 1]?.name
      });
      const ok = await __privateMethod(this, _Data_instances, send_fn).call(this, url, payload, keepalive, preferBeacon);
      if (!ok) {
        __privateSet(this, _buffer, [...batch, ...__privateGet(this, _buffer)]);
        return false;
      }
    }
    return true;
  })().catch((err) => {
    Logger.error("Failed to send metrics", err);
    __privateSet(this, _buffer, [...events, ...__privateGet(this, _buffer)]);
    return false;
  }).then((ok) => {
    Logger.debug("Data.flush.done", { ok, remaining_buffer: __privateGet(this, _buffer).length });
    if (ok && __privateGet(this, _buffer).length > 0) {
      shouldFlushAgain = true;
    }
    return ok;
  }).finally(() => {
    __privateSet(this, _flushInFlight, null);
    if (__privateGet(this, _buffer).length === 0) {
      __privateMethod(this, _Data_instances, stopFlushInterval_fn).call(this);
    }
    if (shouldFlushAgain) {
      __privateMethod(this, _Data_instances, flush_fn).call(this);
    }
  }));
};
stopFlushInterval_fn = function() {
  if (__privateGet(this, _flushInterval) == null) return;
  if (typeof globalThis.clearInterval === "function") {
    globalThis.clearInterval(__privateGet(this, _flushInterval));
  }
  __privateSet(this, _flushInterval, null);
};
teardown_fn = function() {
  if (typeof window !== "undefined" && __privateGet(this, _visibilityChangeHandler)) {
    document.removeEventListener("visibilitychange", __privateGet(this, _visibilityChangeHandler));
    window.removeEventListener("pagehide", __privateGet(this, _visibilityChangeHandler));
    window.removeEventListener("beforeunload", __privateGet(this, _visibilityChangeHandler));
  }
  __privateMethod(this, _Data_instances, stopFlushInterval_fn).call(this);
  __privateSet(this, _buffer, []);
  __privateSet(this, _flushInFlight, null);
};
chunkEvents_fn = function(events) {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const event of events) {
    const eventBytes = __privateMethod(this, _Data_instances, approxEventBytes_fn).call(this, event);
    const wouldExceedBytes = currentBytes + eventBytes > __privateGet(this, _MAX_BYTES_PER_BATCH);
    const wouldExceedCount = current.length >= __privateGet(this, _MAX_EVENTS_PER_BATCH);
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
};
approxEventBytes_fn = function(event) {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 1024;
  }
};
send_fn = async function(url, payload, keepalive, preferBeacon) {
  if (preferBeacon && keepalive && __privateMethod(this, _Data_instances, sendBeacon_fn).call(this, url, payload)) {
    Logger.debug("Data.send.beacon", { url, bytes: JSON.stringify(payload).length });
    return true;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      keepalive,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    Logger.debug("Data.send.fetch", { url, ok: res.ok, status: res.status });
    return res.ok;
  } catch (err) {
    Logger.error("Failed to send metrics", err);
    Logger.debug("Data.send.fetch.error", err);
    return false;
  }
};
sendBeacon_fn = function(url, payload) {
  try {
    if (typeof navigator === "undefined") return false;
    if (typeof navigator.sendBeacon !== "function") return false;
    const json = JSON.stringify(payload);
    if (json.length > __privateGet(this, _MAX_BYTES_PER_BATCH)) return false;
    const blob = new Blob([json], { type: "application/json" });
    return navigator.sendBeacon(url, blob);
  } catch (_err) {
    return false;
  }
};
handleVisibilityChange_fn = function(event) {
  const isUnload = event?.type === "pagehide" || event?.type === "beforeunload";
  const isHidden = document.visibilityState === "hidden";
  if (isUnload || isHidden) {
    Logger.debug(`Data.handleVisibilityChange (${event?.type || "visibility"})`, { state: document.visibilityState });
    __privateMethod(this, _Data_instances, flush_fn).call(this, { keepalive: true, preferBeacon: true });
  }
};
var Data = _Data;

// src/utils.ts
function uuid() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  if (cryptoObj?.getRandomValues) {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
      const rnd = cryptoObj.getRandomValues(new Uint8Array(1))[0] ?? 0;
      return (Number(c) ^ (rnd & 15) >> Number(c) / 4).toString(16);
    });
  }
  const rand = Math.random().toString(16).slice(2).padEnd(12, "0");
  const time = Date.now().toString(16).padStart(12, "0");
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-4000-8000-${rand.slice(0, 12)}`;
}

// src/index.ts
var NativeEvents = /* @__PURE__ */ ((NativeEvents2) => {
  NativeEvents2["PLAYING"] = "playing";
  NativeEvents2["ENDED"] = "ended";
  NativeEvents2["PAUSE"] = "pause";
  return NativeEvents2;
})(NativeEvents || {});
var _video, _lastEventType, _monitoring, _wasPlayingBeforeSeek, _seekPlayTimeoutId, _awaitingSeekResumePlay, _suppressNativePlayUntilMs, _lastObservedVideoTime, _playbackRafId, _lastPlayAtMs, _pendingPauseTimeoutId, _pendingPauseParams, _EARLY_PAUSE_WINDOW_MS, _EARLY_PAUSE_MAX_VIDEO_TIME_S, _EARLY_PAUSE_DEBOUNCE_MS, _lastPlayWasSeekResume, _onNativeEvent, _Metrics_instances, clearSeekPlayTimeout_fn, _onSeeking, _onSeeked, _onVisibilityChange, _onPageHide, baseEventParams_fn, emitPauseIfPlaying_fn, queuePauseIfNeeded_fn, queuePauseToCloseSession_fn, clearPendingPause_fn, flushPendingPause_fn, schedulePause_fn, recordSession_fn, unrecordSession_fn, startPlaybackSampling_fn, stopPlaybackSampling_fn, recordEvent_fn;
var Metrics = class {
  constructor(...args) {
    __privateAdd(this, _Metrics_instances);
    this.VERSION = "0.1.0";
    __privateAdd(this, _video);
    __privateAdd(this, _lastEventType, null);
    __privateAdd(this, _monitoring, false);
    __privateAdd(this, _wasPlayingBeforeSeek, false);
    __privateAdd(this, _seekPlayTimeoutId, null);
    __privateAdd(this, _awaitingSeekResumePlay, false);
    __privateAdd(this, _suppressNativePlayUntilMs, 0);
    __privateAdd(this, _lastObservedVideoTime, 0);
    __privateAdd(this, _playbackRafId, null);
    // HLS (and some players) can briefly toggle play/pause during startup while
    // buffering/attaching media. We debounce an "early" pause right after play
    // and cancel it if playback resumes.
    __privateAdd(this, _lastPlayAtMs, null);
    __privateAdd(this, _pendingPauseTimeoutId, null);
    __privateAdd(this, _pendingPauseParams, null);
    __privateAdd(this, _EARLY_PAUSE_WINDOW_MS, 750);
    __privateAdd(this, _EARLY_PAUSE_MAX_VIDEO_TIME_S, 1);
    __privateAdd(this, _EARLY_PAUSE_DEBOUNCE_MS, 300);
    __privateAdd(this, _lastPlayWasSeekResume, false);
    __privateAdd(this, _onNativeEvent, (event) => __privateMethod(this, _Metrics_instances, recordEvent_fn).call(this, event));
    __privateAdd(this, _onSeeking, () => {
      if (!__privateGet(this, _monitoring)) return;
      if (!__privateGet(this, _video)) return;
      __privateMethod(this, _Metrics_instances, clearSeekPlayTimeout_fn).call(this);
      Logger.debug("Metrics.native.seeking", {
        currentTime: __privateGet(this, _video).currentTime,
        lastObservedVideoTime: __privateGet(this, _lastObservedVideoTime),
        paused: __privateGet(this, _video).paused,
        seeking: __privateGet(this, _video).seeking,
        lastEventType: __privateGet(this, _lastEventType)
      });
      const wasPlaying = __privateGet(this, _lastEventType) === "play" || !__privateGet(this, _video).paused && !__privateGet(this, _video).ended;
      if (wasPlaying && __privateGet(this, _lastEventType) !== "pause") {
        __privateSet(this, _wasPlayingBeforeSeek, true);
        __privateSet(this, _awaitingSeekResumePlay, false);
        __privateMethod(this, _Metrics_instances, clearPendingPause_fn).call(this);
        __privateMethod(this, _Metrics_instances, stopPlaybackSampling_fn).call(this);
        const pauseTime = __privateGet(this, _lastObservedVideoTime) || __privateGet(this, _video).currentTime || 0;
        const params = __privateMethod(this, _Metrics_instances, baseEventParams_fn).call(this, "pause");
        Data.push({ ...params, name: "pause", video_time: pauseTime });
        __privateSet(this, _lastEventType, "pause");
        Data.flush();
        Logger.debug("Metrics.scrub.pause_sent", {
          pauseTime,
          currentTime: __privateGet(this, _video).currentTime
        });
      } else {
        Logger.debug("Metrics.scrub.pause_not_sent", {
          wasPlaying,
          lastEventType: __privateGet(this, _lastEventType)
        });
      }
    });
    __privateAdd(this, _onSeeked, () => {
      if (!__privateGet(this, _monitoring)) return;
      if (!__privateGet(this, _video)) return;
      Logger.debug("Metrics.native.seeked", {
        currentTime: __privateGet(this, _video).currentTime,
        paused: __privateGet(this, _video).paused,
        seeking: __privateGet(this, _video).seeking,
        wasPlayingBeforeSeek: __privateGet(this, _wasPlayingBeforeSeek),
        lastEventType: __privateGet(this, _lastEventType)
      });
      if (!__privateGet(this, _wasPlayingBeforeSeek)) return;
      __privateMethod(this, _Metrics_instances, clearSeekPlayTimeout_fn).call(this);
      __privateSet(this, _seekPlayTimeoutId, window.setTimeout(() => {
        __privateSet(this, _seekPlayTimeoutId, null);
        if (!__privateGet(this, _monitoring)) return;
        if (!__privateGet(this, _video)) return;
        if (__privateGet(this, _lastEventType) === "play") {
          __privateSet(this, _wasPlayingBeforeSeek, false);
          __privateSet(this, _awaitingSeekResumePlay, false);
          return;
        }
        if (!__privateGet(this, _video).seeking && !__privateGet(this, _video).paused && !__privateGet(this, _video).ended) {
          const params = __privateMethod(this, _Metrics_instances, baseEventParams_fn).call(this, "play");
          Data.push({ ...params, name: "play" });
          __privateSet(this, _lastEventType, "play");
          __privateSet(this, _lastPlayAtMs, Date.now());
          __privateSet(this, _lastPlayWasSeekResume, true);
          __privateSet(this, _suppressNativePlayUntilMs, Date.now() + 1500);
          __privateMethod(this, _Metrics_instances, startPlaybackSampling_fn).call(this);
          __privateSet(this, _awaitingSeekResumePlay, false);
          Data.flush();
          __privateSet(this, _wasPlayingBeforeSeek, false);
        } else {
          __privateSet(this, _awaitingSeekResumePlay, true);
          __privateSet(this, _wasPlayingBeforeSeek, false);
        }
      }, 200));
    });
    __privateAdd(this, _onVisibilityChange, () => {
      if (!__privateGet(this, _monitoring)) return;
      if (document.visibilityState === "hidden") {
        Data.flush();
      }
    });
    __privateAdd(this, _onPageHide, (event) => {
      if (!__privateGet(this, _monitoring)) return;
      if (event.persisted) {
        Data.flush();
        return;
      }
      __privateMethod(this, _Metrics_instances, flushPendingPause_fn).call(this);
      __privateMethod(this, _Metrics_instances, queuePauseToCloseSession_fn).call(this);
      Data.flushOnExit();
    });
    this.sessionId = uuid();
    if (args.length < 2) {
      Logger.error(
        "Metrics requires two arguments: a querySelectorable, hls instance or HTMLMediaElement/HTMLVideoElement and a unique embedId for your video."
      );
    } else {
      if (typeof args[0] === "string") {
        this.querySelectorable = args[0];
        this.embedId = args[1];
      }
      if (args[0] instanceof HTMLVideoElement || args[0] instanceof HTMLMediaElement) {
        __privateSet(this, _video, args[0]);
      } else if (typeof args[0] === "object") {
        this.hls = args[0];
      }
      this.embedId = args[1];
      if (args[2]) {
        const options = args[2];
        this.component = options.component;
      }
    }
  }
  static set config(config) {
    Data.config = config;
    if (typeof config.debug === "boolean") {
      Logger.setDebug(config.debug);
    }
  }
  monitor() {
    const video = this.querySelectorable ? document.querySelector(this.querySelectorable) : this.hls?.media;
    if (__privateGet(this, _monitoring)) return this;
    if (video || __privateGet(this, _video)) {
      if (!__privateGet(this, _video)) __privateSet(this, _video, video);
      Logger.debug("Metrics.monitor", {
        embed_id: this.embedId,
        session_id: this.sessionId,
        currentTime: __privateGet(this, _video).currentTime,
        paused: __privateGet(this, _video).paused,
        seeking: __privateGet(this, _video).seeking,
        readyState: __privateGet(this, _video).readyState
      });
      __privateMethod(this, _Metrics_instances, recordSession_fn).call(this);
      __privateSet(this, _lastObservedVideoTime, __privateGet(this, _video).currentTime || 0);
      window.addEventListener("visibilitychange", __privateGet(this, _onVisibilityChange));
      window.addEventListener("pagehide", __privateGet(this, _onPageHide));
      __privateSet(this, _monitoring, true);
    } else {
      Logger.error(
        `${this.querySelectorable} is not a valid reference to a HTMLVideoElement.`
      );
    }
    return this;
  }
  demonitor() {
    if (!__privateGet(this, _monitoring)) return;
    __privateMethod(this, _Metrics_instances, flushPendingPause_fn).call(this);
    __privateMethod(this, _Metrics_instances, emitPauseIfPlaying_fn).call(this);
    __privateMethod(this, _Metrics_instances, clearSeekPlayTimeout_fn).call(this);
    __privateMethod(this, _Metrics_instances, stopPlaybackSampling_fn).call(this);
    __privateMethod(this, _Metrics_instances, unrecordSession_fn).call(this);
    window.removeEventListener("visibilitychange", __privateGet(this, _onVisibilityChange));
    window.removeEventListener("pagehide", __privateGet(this, _onPageHide));
    __privateSet(this, _monitoring, false);
  }
};
_video = new WeakMap();
_lastEventType = new WeakMap();
_monitoring = new WeakMap();
_wasPlayingBeforeSeek = new WeakMap();
_seekPlayTimeoutId = new WeakMap();
_awaitingSeekResumePlay = new WeakMap();
_suppressNativePlayUntilMs = new WeakMap();
_lastObservedVideoTime = new WeakMap();
_playbackRafId = new WeakMap();
_lastPlayAtMs = new WeakMap();
_pendingPauseTimeoutId = new WeakMap();
_pendingPauseParams = new WeakMap();
_EARLY_PAUSE_WINDOW_MS = new WeakMap();
_EARLY_PAUSE_MAX_VIDEO_TIME_S = new WeakMap();
_EARLY_PAUSE_DEBOUNCE_MS = new WeakMap();
_lastPlayWasSeekResume = new WeakMap();
_onNativeEvent = new WeakMap();
_Metrics_instances = new WeakSet();
clearSeekPlayTimeout_fn = function() {
  if (__privateGet(this, _seekPlayTimeoutId) != null) {
    window.clearTimeout(__privateGet(this, _seekPlayTimeoutId));
    __privateSet(this, _seekPlayTimeoutId, null);
  }
};
_onSeeking = new WeakMap();
_onSeeked = new WeakMap();
_onVisibilityChange = new WeakMap();
_onPageHide = new WeakMap();
baseEventParams_fn = function(name) {
  return {
    name,
    duration: __privateGet(this, _video)?.duration,
    video_time: __privateGet(this, _video)?.currentTime,
    session_id: this.sessionId,
    embed_id: this.embedId || "unknown",
    component: this.component,
    source_url: window.location.href,
    timestamp: Date.now()
  };
};
emitPauseIfPlaying_fn = function() {
  if (!__privateGet(this, _video)) return;
  if (__privateGet(this, _video).paused) return;
  if (__privateGet(this, _lastEventType) === "pause") return;
  if (__privateGet(this, _pendingPauseTimeoutId)) return;
  __privateMethod(this, _Metrics_instances, queuePauseIfNeeded_fn).call(this);
  Data.flush();
};
queuePauseIfNeeded_fn = function() {
  if (!__privateGet(this, _video)) return;
  if (__privateGet(this, _lastEventType) === "pause") return;
  if (__privateGet(this, _pendingPauseTimeoutId)) return;
  Data.push(__privateMethod(this, _Metrics_instances, baseEventParams_fn).call(this, "pause"));
  __privateSet(this, _lastEventType, "pause");
};
queuePauseToCloseSession_fn = function() {
  if (!__privateGet(this, _video)) return;
  if (__privateGet(this, _lastEventType) !== "play") return;
  if (__privateGet(this, _pendingPauseTimeoutId)) return;
  Data.push(__privateMethod(this, _Metrics_instances, baseEventParams_fn).call(this, "pause"));
  __privateSet(this, _lastEventType, "pause");
};
clearPendingPause_fn = function() {
  if (__privateGet(this, _pendingPauseTimeoutId)) {
    window.clearTimeout(__privateGet(this, _pendingPauseTimeoutId));
    __privateSet(this, _pendingPauseTimeoutId, null);
  }
  __privateSet(this, _pendingPauseParams, null);
};
flushPendingPause_fn = function() {
  if (!__privateGet(this, _pendingPauseTimeoutId) || !__privateGet(this, _pendingPauseParams)) return;
  window.clearTimeout(__privateGet(this, _pendingPauseTimeoutId));
  const params = __privateGet(this, _pendingPauseParams);
  __privateSet(this, _pendingPauseTimeoutId, null);
  __privateSet(this, _pendingPauseParams, null);
  Data.push(params);
  __privateSet(this, _lastEventType, "pause");
  __privateSet(this, _lastPlayWasSeekResume, false);
  Data.flush();
};
schedulePause_fn = function(params) {
  if (__privateGet(this, _pendingPauseTimeoutId)) return;
  __privateSet(this, _pendingPauseParams, params);
  __privateSet(this, _pendingPauseTimeoutId, window.setTimeout(() => {
    if (!__privateGet(this, _pendingPauseParams)) {
      __privateSet(this, _pendingPauseTimeoutId, null);
      return;
    }
    const payload = __privateGet(this, _pendingPauseParams);
    __privateSet(this, _pendingPauseParams, null);
    __privateSet(this, _pendingPauseTimeoutId, null);
    Data.push(payload);
    __privateSet(this, _lastEventType, "pause");
    Data.flush();
  }, __privateGet(this, _EARLY_PAUSE_DEBOUNCE_MS)));
};
recordSession_fn = function() {
  Logger.debug("Metrics.listeners.attach", {
    embed_id: this.embedId,
    session_id: this.sessionId
  });
  for (const event of Object.values(NativeEvents)) {
    __privateGet(this, _video).addEventListener(event, __privateGet(this, _onNativeEvent));
  }
  __privateGet(this, _video).addEventListener("seeking", __privateGet(this, _onSeeking));
  __privateGet(this, _video).addEventListener("seeked", __privateGet(this, _onSeeked));
};
unrecordSession_fn = function() {
  for (const event of Object.values(NativeEvents)) {
    __privateGet(this, _video).removeEventListener(event, __privateGet(this, _onNativeEvent));
  }
  __privateGet(this, _video).removeEventListener("seeking", __privateGet(this, _onSeeking));
  __privateGet(this, _video).removeEventListener("seeked", __privateGet(this, _onSeeked));
};
startPlaybackSampling_fn = function() {
  if (!__privateGet(this, _video)) return;
  if (__privateGet(this, _playbackRafId) != null) return;
  const tick = () => {
    if (!__privateGet(this, _video)) {
      __privateSet(this, _playbackRafId, null);
      return;
    }
    __privateSet(this, _lastObservedVideoTime, __privateGet(this, _video).currentTime || __privateGet(this, _lastObservedVideoTime));
    if (__privateGet(this, _monitoring) && !__privateGet(this, _video).paused && !__privateGet(this, _video).ended) {
      __privateSet(this, _playbackRafId, window.requestAnimationFrame(tick));
    } else {
      __privateSet(this, _playbackRafId, null);
    }
  };
  __privateSet(this, _playbackRafId, window.requestAnimationFrame(tick));
};
stopPlaybackSampling_fn = function() {
  if (__privateGet(this, _playbackRafId) != null) {
    window.cancelAnimationFrame(__privateGet(this, _playbackRafId));
    __privateSet(this, _playbackRafId, null);
  }
};
recordEvent_fn = function(event) {
  const params = __privateMethod(this, _Metrics_instances, baseEventParams_fn).call(this, event.type);
  Logger.debug("Metrics.native.event", {
    type: event.type,
    currentTime: __privateGet(this, _video)?.currentTime,
    paused: __privateGet(this, _video)?.paused,
    seeking: __privateGet(this, _video)?.seeking,
    readyState: __privateGet(this, _video)?.readyState,
    lastEventType: __privateGet(this, _lastEventType),
    wasPlayingBeforeSeek: __privateGet(this, _wasPlayingBeforeSeek),
    awaitingSeekResumePlay: __privateGet(this, _awaitingSeekResumePlay)
  });
  switch (event.type) {
    case "playing" /* PLAYING */:
      __privateMethod(this, _Metrics_instances, clearPendingPause_fn).call(this);
      if (__privateGet(this, _awaitingSeekResumePlay)) {
        if (__privateGet(this, _lastEventType) !== "play") {
          const playParams = __privateMethod(this, _Metrics_instances, baseEventParams_fn).call(this, "play");
          Data.push({ ...playParams, name: "play" });
          __privateSet(this, _lastEventType, "play");
          __privateSet(this, _lastPlayAtMs, Date.now());
          __privateSet(this, _lastPlayWasSeekResume, true);
          __privateSet(this, _suppressNativePlayUntilMs, Date.now() + 1500);
          __privateMethod(this, _Metrics_instances, startPlaybackSampling_fn).call(this);
          Data.flush();
        }
        __privateSet(this, _awaitingSeekResumePlay, false);
        break;
      }
      if (__privateGet(this, _video)?.seeking || __privateGet(this, _wasPlayingBeforeSeek)) {
        break;
      }
      if (Date.now() < __privateGet(this, _suppressNativePlayUntilMs)) {
        __privateSet(this, _lastEventType, "play");
        __privateMethod(this, _Metrics_instances, startPlaybackSampling_fn).call(this);
        break;
      }
      if (__privateGet(this, _lastEventType) === "play") {
        break;
      }
      Data.push({ ...params, name: "play" });
      __privateSet(this, _lastEventType, "play");
      __privateSet(this, _lastPlayAtMs, Date.now());
      __privateSet(this, _lastPlayWasSeekResume, false);
      __privateMethod(this, _Metrics_instances, startPlaybackSampling_fn).call(this);
      break;
    case "pause" /* PAUSE */:
      if (__privateGet(this, _video)?.seeking) {
        __privateMethod(this, _Metrics_instances, stopPlaybackSampling_fn).call(this);
        break;
      }
      if (__privateGet(this, _lastEventType) === "pause") {
        __privateMethod(this, _Metrics_instances, stopPlaybackSampling_fn).call(this);
        break;
      }
      const timeSincePlayMs = __privateGet(this, _lastPlayAtMs) == null ? Number.POSITIVE_INFINITY : Date.now() - __privateGet(this, _lastPlayAtMs);
      const videoTime = __privateGet(this, _video)?.currentTime ?? 0;
      if (timeSincePlayMs <= __privateGet(this, _EARLY_PAUSE_WINDOW_MS) && (videoTime <= __privateGet(this, _EARLY_PAUSE_MAX_VIDEO_TIME_S) || __privateGet(this, _lastPlayWasSeekResume))) {
        __privateMethod(this, _Metrics_instances, schedulePause_fn).call(this, { ...params, name: "pause" });
        __privateMethod(this, _Metrics_instances, stopPlaybackSampling_fn).call(this);
        break;
      }
      Data.push({ ...params, name: "pause" });
      __privateSet(this, _lastEventType, "pause");
      __privateSet(this, _lastPlayWasSeekResume, false);
      __privateMethod(this, _Metrics_instances, stopPlaybackSampling_fn).call(this);
      Data.flush();
      break;
    case "ended" /* ENDED */:
      __privateMethod(this, _Metrics_instances, clearPendingPause_fn).call(this);
      __privateMethod(this, _Metrics_instances, stopPlaybackSampling_fn).call(this);
      if (__privateGet(this, _lastEventType) !== "pause") {
        Data.push({ ...params, name: "pause" });
        __privateSet(this, _lastEventType, "pause");
        Data.flush();
      }
      break;
    default:
      break;
  }
};
export {
  Metrics
};
