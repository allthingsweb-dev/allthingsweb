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
