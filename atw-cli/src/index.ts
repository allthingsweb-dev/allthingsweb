#!/usr/bin/env bun
import { run } from "./cli.ts";

const opener =
  process.platform === "darwin"
    ? ["open"]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", ""]
      : ["xdg-open"];

const exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- @types/node says boolean, but non-TTY streams leave isTTY undefined
  isTTY: process.stdout.isTTY === true,
  env: process.env,
  openUrl: async (url) => {
    // The link is already printed, so a missing opener (no xdg-open) is fine.
    try {
      await Bun.spawn([...opener, url], { stdout: "ignore", stderr: "ignore" })
        .exited;
    } catch {
      return;
    }
  },
});

process.exit(exitCode);
