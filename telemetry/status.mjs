import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CodexAppServer} from './app-server.mjs';

const execFileAsync = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const clamp = (value) => Math.max(0, Math.min(100, value));

function windowLabel(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function normalizeRateLimits(response) {
  const buckets = response?.rateLimitsByLimitId;
  const selected = buckets?.codex ?? response?.rateLimits ??
    (buckets && Object.values(buckets)[0]);
  if (!selected) throw new Error('QUOTA_UNAVAILABLE');
  const windows = ['primary', 'secondary'].flatMap((kind) => {
    const window = selected[kind];
    if (!window || typeof window.usedPercent !== 'number' ||
        !Number.isFinite(window.usedPercent)) return [];
    const minutes = window.windowDurationMins;
    return [{label: Number.isFinite(minutes) ? windowLabel(minutes) : kind,
      remainingPercent: clamp(100 - window.usedPercent),
      resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : null,
      windowDurationMins: Number.isFinite(minutes) ? minutes : null,
      limitId: selected.limitId || 'codex', kind}];
  });
  if (!windows.length) throw new Error('QUOTA_UNAVAILABLE');
  // The most restrictive Codex window determines the displayed available quota.
  return {remainingPercent: Math.min(...windows.map((w) => w.remainingPercent)), windows};
}

export async function readLocalTasks() {
  const {stdout} = await execFileAsync(process.env.CODEX_RECHARGE_PYTHON || '/usr/bin/python3',
    [join(directory, 'local-tasks.py')], {timeout: 5000, maxBuffer: 8192, windowsHide: true});
  const result = JSON.parse(stdout);
  if (result.tasksStatus !== 'live' || !Number.isSafeInteger(result.activeTasks) || result.activeTasks < 0)
    throw new Error('TASKS_UNAVAILABLE');
  return result;
}

// Dependency injection keeps tests offline. A failed request retains a clearly
// marked stale snapshot; unknown quota or task count is always null, never zero.
export function createStatusReader({
  usageReader, taskReader = readLocalTasks, now = () => Date.now(), cacheFile,
} = {}) {
  const server = usageReader ? null : new CodexAppServer();
  const fetchUsage = usageReader || (() => server.readRateLimits());
  let lastUsage = null;
  let lastTasks = null;
  let usageLive = false;
  let tasksLive = false;
  let loadCache;
  let pendingUsage;
  let pendingTasks;
  let pendingStatus;
  let lastUsageAttempt = -Infinity;
  let closed = false;
  async function load() {
    if (!cacheFile) return;
    try {
      const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (cache.version !== 1) return;
      if (cache.usage && Number.isFinite(cache.usage.timestamp) &&
          typeof cache.usage.remainingPercent === 'number' && Array.isArray(cache.usage.windows)) {
        lastUsage = cache.usage;
      }
      // Task state is never loaded from a prior process; only this process's
      // observed task count may be shown briefly as stale after a read failure.
    } catch {}
  }
  async function save() {
    if (closed || !cacheFile || !lastUsage) return;
    try {
      await mkdir(dirname(cacheFile), {recursive: true, mode: 0o700});
      const temp = `${cacheFile}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({version: 1, usage: lastUsage}) + '\n', {mode: 0o600});
      await rename(temp, cacheFile);
    } catch {}
  }
  async function refreshUsage({maxAgeMs = 0} = {}) {
    await (loadCache ||= load());
    if (closed) return;
    if (pendingUsage) return pendingUsage;
    if (now() - lastUsageAttempt < maxAgeMs) return;
    lastUsageAttempt = now();
    pendingUsage = (async () => {
      try {
        const value = await fetchUsage();
        if (closed) return;
        lastUsage = {...normalizeRateLimits(value), timestamp: now()};
        usageLive = true;
        await save();
      } catch { usageLive = false; }
    })().finally(() => { pendingUsage = null; });
    return pendingUsage;
  }
  async function refreshTasks() {
    await (loadCache ||= load());
    if (closed) return;
    if (pendingTasks) return pendingTasks;
    pendingTasks = (async () => {
      try {
        const value = await taskReader();
        if (closed) return;
        if (value.tasksStatus !== 'live' || !Number.isSafeInteger(value.activeTasks) || value.activeTasks < 0)
          throw new Error('TASKS_UNAVAILABLE');
        lastTasks = {activeTasks: value.activeTasks, timestamp: now()};
        tasksLive = true;
      } catch { tasksLive = false; }
    })().finally(() => { pendingTasks = null; });
    return pendingTasks;
  }
  function snapshot() {
    const timestamp = now();
    const usageAvailable = lastUsage && timestamp - lastUsage.timestamp < 24 * 60 * 60 * 1000;
    const tasksAvailable = lastTasks && timestamp - lastTasks.timestamp < 2 * 60 * 1000;
    return {
      remainingPercent: usageAvailable ? lastUsage.remainingPercent : null,
      windows: usageAvailable ? lastUsage.windows : [],
      activeTasks: tasksAvailable ? lastTasks.activeTasks : null,
      usageStatus: usageAvailable ? usageLive ? 'live' : 'stale' : 'unavailable',
      tasksStatus: tasksAvailable ? tasksLive ? 'live' : 'stale' : 'unavailable',
      updatedAt: new Date(timestamp).toISOString(),
      usageUpdatedAt: usageAvailable ? new Date(lastUsage.timestamp).toISOString() : null,
      tasksUpdatedAt: tasksAvailable ? new Date(lastTasks.timestamp).toISOString() : null,
      source: {
        usage: usageAvailable ? 'codex-app-server-account-rate-limits' : 'unavailable',
        tasks: tasksAvailable ? 'readonly-sqlite-and-held-writer-locks' : 'unavailable',
        tasksScope: 'local-desktop-root-chats',
      },
    };
  }
  return {
    refreshUsage,
    refreshTasks,
    snapshot,
    readStatus() {
      if (!pendingStatus) pendingStatus = Promise.all([refreshUsage(), refreshTasks()])
        .then(snapshot).finally(() => { pendingStatus = null; });
      return pendingStatus;
    },
    async readTaskStatus() {
      await refreshTasks();
      return snapshot();
    },
    close() { closed = true; server?.close(); },
  };
}

let singleton;
function getReader() {
  return singleton ||= createStatusReader({cacheFile: process.env.CODEX_RECHARGE_DATA_DIR
    ? join(process.env.CODEX_RECHARGE_DATA_DIR, 'quota-cache.json') : undefined});
}
export function readStatus() { return getReader().readStatus(); }
export function readTaskStatus() { return getReader().readTaskStatus(); }
export function refreshUsage(options) { return getReader().refreshUsage(options); }
export function closeTelemetry() { singleton?.close(); singleton = undefined; }
