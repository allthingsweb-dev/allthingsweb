#!/usr/bin/env bun
import { invokedAsLegacy } from "./config.ts";
import { main } from "./main.ts";

// The compiled binary is also installed as an `atw` symlink, so the name it
// was started by decides whether to print the old name's note.
await main(invokedAsLegacy(process.argv0));
