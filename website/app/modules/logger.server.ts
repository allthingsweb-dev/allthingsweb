import Signale from "signale";

export type Logger = {
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  fatal: (...args: any[]) => void;
  success: (...args: any[]) => void;
  start: (...args: any[]) => void;
  note: (...args: any[]) => void;
  log: (...args: any[]) => void;
};

export type WithLogger<T = any> = T & {
  logger: Logger;
};

export const createLogger = (
  scope: string,
  levels: Array<"info" | "debug">,
): Logger => {
  const signale = new Signale.Signale({
    logLevel: "info", // we always display the maximum level of Signal and filter later
    interactive: false,
    scope,
    config: {
      displayTimestamp: true,
      displayDate: true,
    },
  });
  const log = (type: string, ...args: any[]) => {
    switch (type) {
      case "info":
        if (levels.includes("info")) {
          signale.info(...args);
        }
        break;
      case "debug":
        if (levels.includes("debug")) {
          signale.debug(...args);
        }
        break;
      case "warn":
        signale.warn(...args);
        break;
      case "error":
        signale.error(...args);
        break;
      case "fatal":
        signale.fatal(...args);
        break;
      case "success":
        signale.success(...args);
        break;
      case "start":
        signale.start(...args);
        break;
      case "note":
        signale.note(...args);
        break;
      case "log":
        if (levels.includes("debug")) {
          signale.log(...args);
        }
        break;
      default:
        throw new Error(`Invalid log type: ${type}`);
    }
  };

  return {
    info: (...args: any[]) => log("info", ...args),
    debug: (...args: any[]) => log("debug", ...args),
    warn: (...args: any[]) => log("warn", ...args),
    error: (...args: any[]) => log("error", ...args),
    fatal: (...args: any[]) => log("fatal", ...args),
    success: (...args: any[]) => log("success", ...args),
    start: (...args: any[]) => log("start", ...args),
    note: (...args: any[]) => log("note", ...args),
    log: (...args: any[]) => log("log", ...args),
  };
};
