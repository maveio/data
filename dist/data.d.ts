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
    apiEndpoint: string;
    debug?: boolean;
}
export default class Data {
    #private;
    private static instance;
    private constructor();
    static get instance_(): Data;
    static set config(config: Config);
    static push(event: Partial<Event>): void;
    static flush(): void;
    static flushAsync(): Promise<boolean>;
    static flushOnExit(): void;
    /** @internal */
    static __resetForTests(): void;
}
