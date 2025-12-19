export function uuid() {
  const cryptoObj = globalThis.crypto;

  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();

  if (cryptoObj?.getRandomValues) {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
      const rnd = cryptoObj.getRandomValues(new Uint8Array(1))[0] ?? 0;
      return (Number(c) ^ (rnd & 15) >> (Number(c) / 4)).toString(16);
    });
  }

  // Very old/non-browser environments: not cryptographically strong,
  // but good enough for session correlation.
  const rand = Math.random().toString(16).slice(2).padEnd(12, "0");
  const time = Date.now().toString(16).padStart(12, "0");
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-4000-8000-${rand.slice(0, 12)}`;
}
