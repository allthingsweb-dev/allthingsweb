#!/usr/bin/env bun
import { main } from "./main.ts";

// The package's `atw` bin: the old name, kept as an alias for now.
await main(true);
