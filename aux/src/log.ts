import { appendFileSync } from "node:fs";

/**
 * The audit log: one JSON line per tool call, appended and never
 * rewritten (aux.log.jsonl by default, gitignored). An entry names a guest
 * by code id, never by code, and records only names the hub knows (a
 * configured scene, color or zone): nothing a guest typed is written.
 */
export interface AuditEntry {
  /** ISO time. */
  readonly at: string;
  readonly tool: string;
  readonly caller: "guest" | "host" | "anonymous";
  /** The guest's code id (codes.ts), when a valid code called. */
  readonly code_id?: string;
  /** "ok", or the error code the caller got. */
  readonly outcome: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export class AuditLog {
  readonly #path: string | undefined;
  readonly #keep: number;
  readonly #recent: AuditEntry[] = [];

  /** Appends to `path`; without one, keeps the recent entries only (tests). */
  constructor(path: string | undefined, keep = 20) {
    this.#path = path;
    this.#keep = keep;
  }

  write(entry: AuditEntry): void {
    if (this.#path !== undefined) {
      appendFileSync(this.#path, `${JSON.stringify(entry)}\n`, {
        mode: 0o600,
      });
    }
    this.#recent.push(entry);
    if (this.#recent.length > this.#keep) this.#recent.shift();
  }

  /** The last entries, oldest first, for the host's status. */
  recent(): readonly AuditEntry[] {
    return [...this.#recent];
  }
}
