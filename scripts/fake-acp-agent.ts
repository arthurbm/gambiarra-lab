#!/usr/bin/env bun
// The deterministic fake ACP agent from gambi-sdk. A bundled SDK cannot find
// its own copy, so `fake` harnesses here run this file through
// createFakeHarnessAdapter({ command: process.execPath, args: [<this file>] }).
import { runFakeAcpAgent } from "gambi-sdk";

await runFakeAcpAgent();
