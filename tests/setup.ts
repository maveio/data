// Shared Vitest setup for browser-like globals.
// happy-dom provides window/document; we only set safe defaults here.

// Some tests stub fetch explicitly; provide a helpful default error if not.
if (typeof globalThis.fetch !== "function") {
  (globalThis as unknown as { fetch: () => never }).fetch = () => {
    throw new Error("fetch is not stubbed in this test");
  };
}
