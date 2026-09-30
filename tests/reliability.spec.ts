import Data, { type Event as MetricsEvent } from '../src/data';
import { Metrics } from '../src/index';

let metrics: Metrics | undefined;
const fetchMock = vi.fn<typeof fetch>();

function sentEvents(): MetricsEvent[] {
  return fetchMock.mock.calls.flatMap(([, options]) =>
    JSON.parse(String(options?.body)).events,
  );
}

function audioElement() {
  const audio = document.createElement('audio');
  Object.defineProperties(audio, {
    readyState: { value: 4, configurable: true },
    duration: { value: 120, configurable: true },
    currentTime: { value: 0, writable: true, configurable: true },
    paused: { value: false, writable: true, configurable: true },
  });
  return audio;
}

beforeEach(() => {
  vi.useFakeTimers();
  Data.__resetForTests();
  fetchMock.mockReset().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false);
  Metrics.config = { apiEndpoint: '/v1/events' };
});

afterEach(async () => {
  metrics?.demonitor();
  metrics = undefined;
  await Data.flushAsync();
  Data.__resetForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('tracks native audio once and stops collecting after demonitor', async () => {
  const audio = audioElement();
  metrics = new Metrics(audio, 'aaaaabbbbbccccc', { component: 'audio' });
  metrics.monitor().monitor();
  audio.dispatchEvent(new Event('playing'));
  audio.dispatchEvent(new Event('playing'));
  vi.advanceTimersByTime(1500);
  audio.currentTime = 2;

  // Removing a playing component must close the listening interval as well.
  metrics.demonitor();
  await Data.flushAsync();
  expect(sentEvents()).toMatchObject([
    { name: 'play', component: 'audio', embed_id: 'aaaaabbbbbccccc', video_time: 0 },
    { name: 'pause', component: 'audio', embed_id: 'aaaaabbbbbccccc', video_time: 2 },
  ]);
  expect(new Set(sentEvents().map((event) => event.session_id))).toEqual(
    new Set([metrics.sessionId]),
  );

  const requestCount = fetchMock.mock.calls.length;
  audio.dispatchEvent(new Event('playing'));
  audio.dispatchEvent(new Event('pause'));
  await vi.advanceTimersByTimeAsync(6000);
  await Data.flushAsync();
  expect(fetchMock).toHaveBeenCalledTimes(requestCount);
});

it('retries a failed delivery without losing or reordering buffered events', async () => {
  fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
  const first = { name: 'play', session_id: 'session', timestamp: 1 };
  const second = { name: 'pause', session_id: 'session', timestamp: 2 };
  Data.push(first);
  Data.push(second);
  expect(await Data.flushAsync()).toBe(false);

  const third = { name: 'play', session_id: 'session', timestamp: 3 };
  Data.push(third);
  expect(await Data.flushAsync()).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).events).toEqual([
    first, second, third,
  ]);
  await Data.flushAsync();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps background audio playing but closes its interval when the page exits', async () => {
  const audio = audioElement();
  metrics = new Metrics(audio, 'aaaaabbbbbccccc', { component: 'audio' }).monitor();
  audio.dispatchEvent(new Event('playing'));
  vi.advanceTimersByTime(1500);
  audio.currentTime = 2;

  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await Data.flushAsync();
  expect(sentEvents().map((event) => event.name)).toEqual(['play']);

  // Verify the fetch fallback used when sendBeacon cannot queue the request.
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  await Data.flushAsync();
  expect(sentEvents().map((event) => event.name)).toEqual(['play', 'pause']);
  expect(sentEvents()[1].video_time).toBe(2);
  expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1]?.keepalive).toBe(true);
});
