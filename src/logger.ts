export default class Logger {
  static #debugEnabled = false;

  static setDebug(enabled: boolean): void {
    Logger.#debugEnabled = enabled;
  }

  static debugEnabled(): boolean {
    if (Logger.#debugEnabled) return true;

    try {
      const anyGlobal = globalThis as unknown as {
        __MAVE_DATA_DEBUG__?: boolean;
        localStorage?: { getItem(key: string): string | null };
      };

      if (anyGlobal.__MAVE_DATA_DEBUG__ === true) return true;
      if (anyGlobal.localStorage?.getItem("MAVE_DATA_DEBUG") === "1") return true;
    } catch {
      // ignore
    }

    return false;
  }

  static log(message: string): void {
    console.log(`[mave_data]: ${message}`);
  }

  static error(message: string, meta?: unknown): void {
    if (typeof meta === "undefined") {
      console.error(`[mave_data]: ${message}`);
    } else {
      console.error(`[mave_data]: ${message}`, meta);
    }
  }

  static debug(message: string, meta?: unknown): void {
    if (!Logger.debugEnabled()) return;

    if (typeof meta === "undefined") {
      console.debug(`[mave_data]: ${message}`);
    } else {
      console.debug(`[mave_data]: ${message}`, meta);
    }
  }
}
