#!/usr/bin/env bun
// Stops the `frevo:dev` of this worktree, and nothing else: it reads the
// pidfile `frevo:dev` writes (.frevo-dev.json at the worktree root) instead
// of matching processes by name, which once took down another worktree's run.
//
//   bun run frevo:stop
import { stopRecorded } from "./frevo-pidfile";

const result = await stopRecorded();
console.log(result.message);
process.exit(result.leftovers.length > 0 ? 1 : 0);
