export default class Logger {
    #private;
    static setDebug(enabled: boolean): void;
    static debugEnabled(): boolean;
    static log(message: string): void;
    static error(message: string, meta?: unknown): void;
    static debug(message: string, meta?: unknown): void;
}
