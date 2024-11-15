export type PerformanceServerTimings = Record<string, Array<PerformanceServerTiming>>;
export type TimeFn = ServerTimingsProfiler['time'];
export type ServerTimingsProfiler = {
  time<T>(
    serverTiming:
      | string
      | {
          name: string;
          description: string;
        },
    fn: Promise<T> | (() => Promise<T>),
  ): Promise<T>;
  timeSync<T>(
    serverTiming:
      | string
      | {
          name: string;
          description: string;
        },
    fn: () => T,
  ): T;
  getHeaderField(): string;
  getServerTimingHeader(): Record<string, string>;
};
