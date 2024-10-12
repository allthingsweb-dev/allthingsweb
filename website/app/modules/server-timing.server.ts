/*
 * Shout-out to Jacob Paris (@jacobmparis) for this gist:
 * https://gist.github.com/jacobparis/1e428524be3a31096ba3ecb35a7a15bb
 */

export type PerformanceServerTimings = Record<string, Array<PerformanceServerTiming>>;

export type TimeFn = ReturnType<typeof getServerTiming>['time'];

/**
 * Run this on the server to get a `time` function that can be used to time
 * server-side operations and add them to the `Server-Timing` header.
 */
export function getServerTiming() {
  const serverTimings: PerformanceServerTimings = {};

  return {
    time<T>(
      serverTiming:
        | string
        | {
            name: string;
            description: string;
          },
      fn: Promise<T> | (() => Promise<T>),
    ) {
      return time(serverTimings, serverTiming, fn);
    },
    timeSync<T>(
      serverTiming:
        | string
        | {
            name: string;
            description: string;
          },
      fn: () => T,
    ) {
      return timeSync(serverTimings, serverTiming, fn);
    },
    getHeaderField() {
      return getServerTimeHeaderField(serverTimings);
    },
    getServerTimingHeader() {
      return {
        'Server-Timing': getServerTimeHeaderField(serverTimings),
      };
    },
  };
}

async function time<T>(
  serverTimings: PerformanceServerTimings,
  serverTimingParam:
    | string
    | {
        name: string;
        description: string;
      },
  fn: Promise<T> | (() => Promise<T>),
) {
  const start = performance.now();

  const name = typeof serverTimingParam === 'string' ? serverTimingParam : serverTimingParam.name;
  const description = typeof serverTimingParam === 'string' ? '' : serverTimingParam.description;

  if (!serverTimings[name]) {
    serverTimings[name] = [];
  }

  let result: T;
  try {
    result = typeof fn === 'function' ? await fn() : await fn;
  } catch (error) {
    void recordServerTiming(serverTimings, {
      name,
      description: 'Error',
    });

    // Re-throw the error so that the caller can handle it
    throw error;
  }

  void recordServerTiming(serverTimings, {
    name,
    description,
    duration: performance.now() - start,
  });

  return result;
}

function timeSync<T>(
  serverTimings: PerformanceServerTimings,
  serverTimingParam:
    | string
    | {
        name: string;
        description: string;
      },
  fn: () => T,
) {
  const start = performance.now();

  const name = typeof serverTimingParam === 'string' ? serverTimingParam : serverTimingParam.name;
  const description = typeof serverTimingParam === 'string' ? '' : serverTimingParam.description;

  if (!serverTimings[name]) {
    serverTimings[name] = [];
  }

  let result: T;
  try {
    result = fn();
  } catch (error) {
    void recordServerTiming(serverTimings, {
      name,
      description: 'Error',
    });

    // Re-throw the error so that the caller can handle it
    throw error;
  }

  void recordServerTiming(serverTimings, {
    name,
    description,
    duration: performance.now() - start,
  });

  return result;
}

function recordServerTiming(
  serverTimings: PerformanceServerTimings,
  timing: {
    name: string;
    description?: string;
    duration?: number;
  },
) {
  const serverTiming: PerformanceServerTiming = {
    name: timing.name,
    description: timing.description ?? '',
    duration: timing.duration ?? 0,
    toJSON() {
      // https://w3c.github.io/server-timing/#dom-performanceservertiming-tojson
      // we don't need this, but the PerformanceServerTiming spec asks for it
      return JSON.parse(JSON.stringify(serverTiming));
    },
  };

  serverTimings[timing.name].push(serverTiming);
}

function getServerTimeHeaderField(serverTimings: PerformanceServerTimings) {
  // https://w3c.github.io/server-timing/#the-server-timing-header-field
  return Object.entries(serverTimings)
    .map(([name, timingInfos]) => {
      // duration is in milliseconds with microseconds precision
      const dur = timingInfos.reduce((totalDuration, { duration }) => totalDuration + duration, 0).toFixed(3);

      const desc = timingInfos
        .map(({ description }) => description)
        .filter(Boolean)
        .join(' & ');

      return [
        name.replaceAll(/(:| |@|=|;|,)/g, '_'),
        // desc and dur are both optional
        desc ? `desc=${JSON.stringify(desc)}` : null,
        dur ? `dur=${dur}` : null,
      ]
        .filter(Boolean)
        .join(';');
    })
    .join(',');
}
