#!/usr/bin/env node
import {join} from 'node:path';
import {createStatusReader} from './status.mjs';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const intervalIndex = args.indexOf('--interval');
const requestedInterval = intervalIndex >= 0 ? Number(args[intervalIndex + 1]) : 30000;
const interval = Number.isFinite(requestedInterval) ? Math.max(5000, requestedInterval) : 30000;
const taskIntervalIndex = args.indexOf('--task-interval');
const requestedTaskInterval = taskIntervalIndex >= 0 ? Number(args[taskIntervalIndex + 1]) : 1000;
const taskInterval = Number.isFinite(requestedTaskInterval) ? Math.max(250, requestedTaskInterval) : 1000;
const reader = createStatusReader({cacheFile: process.env.CODEX_RECHARGE_DATA_DIR
  ? join(process.env.CODEX_RECHARGE_DATA_DIR, 'quota-cache.json') : undefined});
let stopping = false;
const timers = new Set();
function stop() {
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  reader.close();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.stdout.on('error', stop);

async function update(refresh, delay) {
  try {
    await refresh();
    if (!stopping) process.stdout.write(JSON.stringify(reader.snapshot()) + '\n');
  } catch {
    // Only generic diagnostics: never print raw RPC messages, auth or paths.
    if (!stopping) process.stderr.write('Codex Recharge telemetry is unavailable.\n');
  }
  if (watch && !stopping) {
    const timer = setTimeout(() => { timers.delete(timer); void update(refresh, delay); }, delay);
    timers.add(timer);
  }
}
if (watch) {
  // Independent loops let task changes reach the view while a quota RPC waits.
  await Promise.all([update(() => reader.refreshTasks(), taskInterval),
    update(() => reader.refreshUsage(), interval)]);
} else {
  await update(() => reader.readStatus());
  reader.close();
}
