interface Hls {
    media: HTMLMediaElement | null;
}
type MetricsOptions = {
    component?: string;
};
declare class Metrics {
    #private;
    VERSION: string;
    querySelectorable?: string;
    hls?: Hls;
    embedId?: string;
    component?: string;
    sessionId: string;
    constructor(querySelectorable: string, embedId: string, options?: MetricsOptions);
    constructor(videoElement: HTMLMediaElement | HTMLVideoElement, embedId: string, options?: MetricsOptions);
    constructor(hls: Hls, embedId: string, options?: MetricsOptions);
    static set config(config: {
        apiEndpoint: string;
        debug?: boolean;
    });
    monitor(): Metrics;
    demonitor(): void;
}

export { Metrics, type MetricsOptions };
