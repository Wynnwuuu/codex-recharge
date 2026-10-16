#!/usr/bin/env node
import {readStatus, closeTelemetry} from './status.mjs';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const intervalIndex = args.indexOf('--interval');
const requestedInterval = intervalIndex >= 0 ? Number(args[intervalIndex + 1]) : 30000;
const interval = Number.isFinite(requestedInterval) ? Math.max(5000, requestedInterval) : 30000;
let stopping = false;
let timer;
function stop() {
  stopping = true;
  clearTimeout(timer);
  closeTelemetry();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.stdout.on('error', stop);

async function update() {
  try {
    const status = await readStatus();
    if (!stopping) process.stdout.write(JSON.stringify(status) + '\n');
  } catch {
    // Only generic diagnostics: never print raw RPC messages, auth or paths.
    if (!stopping) process.stderr.write('Codex Recharge telemetry is unavailable.\n');
  }
  if (watch && !stopping) timer = setTimeout(update, interval);
  else closeTelemetry();
}
await update();
