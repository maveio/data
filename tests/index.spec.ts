import Data from "../src/data";
import { Metrics } from "../src/index";

function jsonBodyFromFetchCall(call: unknown[]) {
	const init = call[1] as RequestInit;
	return JSON.parse(String(init.body ?? "{}"));
}

describe("Internals", () => {
	beforeEach(() => {
		Data.__resetForTests();
	});

	it("POSTs buffered events to configured apiEndpoint", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		Data.config = { apiEndpoint: "/v1/events" };

		Data.push({ name: "play", session_id: "s1", embed_id: "aaaaabbbbbccccc", timestamp: 1 });

		await Data.flushAsync();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("/v1/events");

		const payload = jsonBodyFromFetchCall(fetchMock.mock.calls[0] as unknown[]);
		expect(payload.events).toHaveLength(1);
		expect(payload.events[0].name).toBe("play");
		expect(payload.events[0].embed_id).toBe("aaaaabbbbbccccc");
		expect(payload.events[0].session_id).toBe("s1");
	});

	it("batches to max 50 events per request", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		Data.config = { apiEndpoint: "/v1/events" };

		for (let i = 0; i < 60; i++) {
			Data.push({
				name: "play",
				session_id: "s1",
				embed_id: "aaaaabbbbbccccc",
				timestamp: i + 1,
				video_time: i,
			});
		}

		await Data.flushAsync();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const first = jsonBodyFromFetchCall(fetchMock.mock.calls[0] as unknown[]);
		const second = jsonBodyFromFetchCall(fetchMock.mock.calls[1] as unknown[]);
		expect(first.events).toHaveLength(50);
		expect(second.events).toHaveLength(10);
	});
});

describe("Client", () => {
	beforeEach(() => {
		Data.__resetForTests();
	});

	it("emits play then pause and flushes to Core", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

		const fetchMock = vi.fn(async () => ({ ok: true }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		Metrics.config = { apiEndpoint: "/v1/events" };

		const video = document.createElement("video") as HTMLVideoElement;

		// happy-dom doesn't model media playback state; define what we need.
		Object.defineProperty(video, "readyState", { value: 4, configurable: true });
		Object.defineProperty(video, "seeking", { value: false, configurable: true });
		Object.defineProperty(video, "ended", { value: false, configurable: true });
		Object.defineProperty(video, "paused", { value: false, configurable: true });

		Object.defineProperty(video, "duration", { value: 120, configurable: true });
		Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });

		const embedId = "ubg50LeDE9v86ye";
		const metrics = new Metrics(video, embedId).monitor();

		video.dispatchEvent(new Event("playing"));

		// Avoid the early-pause debounce path.
		(video as unknown as { currentTime: number }).currentTime = 10;
		vi.advanceTimersByTime(1000);

		video.dispatchEvent(new Event("pause"));
		await Data.flushAsync();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const payload = jsonBodyFromFetchCall(fetchMock.mock.calls[0] as unknown[]);
		expect(payload.events).toHaveLength(2);
		expect(payload.events[0].name).toBe("play");
		expect(payload.events[1].name).toBe("pause");
		expect(payload.events[0].embed_id).toBe(embedId);
		expect(payload.events[1].embed_id).toBe(embedId);
		expect(metrics.sessionId).toBeTruthy();

		vi.useRealTimers();
	});

	it("coalesces scrub while playing into pause@old_time then play@new_time", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

		const fetchMock = vi.fn(async () => ({ ok: true }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		Metrics.config = { apiEndpoint: "/v1/events" };

		const video = document.createElement("video") as HTMLVideoElement;
		Object.defineProperty(video, "readyState", { value: 4, configurable: true });
		Object.defineProperty(video, "seeking", { value: false, writable: true, configurable: true });
		Object.defineProperty(video, "ended", { value: false, configurable: true });
		Object.defineProperty(video, "paused", { value: false, writable: true, configurable: true });
		Object.defineProperty(video, "duration", { value: 120, configurable: true });
		Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });

		const embedId = "ubg50LeDE9v86ye";
		new Metrics(video, embedId).monitor();

		// Start playing.
		video.dispatchEvent(new Event("playing"));

		// Scrub while playing: seeking should immediately push+flush pause@old.
		(video as unknown as { currentTime: number }).currentTime = 12;
		(video as unknown as { seeking: boolean }).seeking = true;
		video.dispatchEvent(new Event("seeking"));

		// Seek settles at a new time; some browsers report paused briefly.
		(video as unknown as { currentTime: number }).currentTime = 48;
		(video as unknown as { seeking: boolean }).seeking = false;
		(video as unknown as { paused: boolean }).paused = true;
		video.dispatchEvent(new Event("seeked"));

		// After buffering, playback resumes.
		vi.advanceTimersByTime(250);
		(video as unknown as { paused: boolean }).paused = false;
		video.dispatchEvent(new Event("playing"));

		await Data.flushAsync();

		// First flush happens on seeking (to close the viewing interval).
		// Second flush happens when playback resumes.
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const first = jsonBodyFromFetchCall(fetchMock.mock.calls[0] as unknown[]);
		expect(first.events.map((e: any) => e.name)).toEqual(["play", "pause"]);
		expect(first.events[1].video_time).toBe(12);

		const second = jsonBodyFromFetchCall(fetchMock.mock.calls[1] as unknown[]);
		expect(second.events.map((e: any) => e.name)).toEqual(["play"]);
		expect(second.events[0].video_time).toBe(48);

		vi.useRealTimers();
	});

	it("does not drop pause when readyState is not 4", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

		const fetchMock = vi.fn(async () => ({ ok: true }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		Metrics.config = { apiEndpoint: "/v1/events" };

		const video = document.createElement("video") as HTMLVideoElement;
		Object.defineProperty(video, "readyState", { value: 2, configurable: true });
		Object.defineProperty(video, "seeking", { value: false, configurable: true });
		Object.defineProperty(video, "ended", { value: false, configurable: true });
		Object.defineProperty(video, "paused", { value: false, configurable: true });
		Object.defineProperty(video, "duration", { value: 120, configurable: true });
		Object.defineProperty(video, "currentTime", { value: 3, writable: true, configurable: true });

		new Metrics(video, "ubg50LeDE9v86ye").monitor();
		video.dispatchEvent(new Event("playing"));

		// Wait beyond early-pause debounce window.
		vi.advanceTimersByTime(1000);

		video.dispatchEvent(new Event("pause"));
		await Data.flushAsync();

		const first = jsonBodyFromFetchCall(fetchMock.mock.calls[0] as unknown[]);
		expect(first.events.map((e: any) => e.name)).toEqual(["play", "pause"]);

		vi.useRealTimers();
	});

	it("still emits scrub pause when native pause fires first", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

		const fetchMock = vi.fn(async () => ({ ok: true }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		Metrics.config = { apiEndpoint: "/v1/events" };

		const video = document.createElement("video") as HTMLVideoElement;
		Object.defineProperty(video, "readyState", { value: 4, configurable: true });
		Object.defineProperty(video, "seeking", { value: false, writable: true, configurable: true });
		Object.defineProperty(video, "ended", { value: false, configurable: true });
		Object.defineProperty(video, "paused", { value: false, writable: true, configurable: true });
		Object.defineProperty(video, "duration", { value: 120, configurable: true });
		Object.defineProperty(video, "currentTime", { value: 10, writable: true, configurable: true });

		new Metrics(video, "ubg50LeDE9v86ye").monitor();

		// Start play interval.
		video.dispatchEvent(new Event("playing"));

		// Browser-like ordering during scrub: pause fires while seeking=true, then seeking.
		(video as unknown as { seeking: boolean }).seeking = true;
		(video as unknown as { paused: boolean }).paused = true;
		video.dispatchEvent(new Event("pause"));
		video.dispatchEvent(new Event("seeking"));

		await Data.flushAsync();

		// First flush should contain play + scrub-start pause.
		const first = jsonBodyFromFetchCall(fetchMock.mock.calls[0] as unknown[]);
		expect(first.events.map((e: any) => e.name)).toEqual(["play", "pause"]);

		vi.useRealTimers();
	});
});
