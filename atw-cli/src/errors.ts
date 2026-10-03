/** Exit codes are part of the CLI's contract with scripts and agents. */
export const ExitCode = {
  Ok: 0,
  ServiceError: 1,
  UsageError: 2,
  NotFound: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class CliError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
