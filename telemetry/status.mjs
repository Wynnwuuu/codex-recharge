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
  let loadCache;
  let pending;
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
    if (!cacheFile || !lastUsage) return;
    try {
      await mkdir(dirname(cacheFile), {recursive: true, mode: 0o700});
      const temp = `${cacheFile}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({version: 1, usage: lastUsage}) + '\n', {mode: 0o600});
      await rename(temp, cacheFile);
    } catch {}
  }
  async function collect() {
    await (loadCache ||= load());
    const [usage, tasks] = await Promise.allSettled([fetchUsage(), taskReader()]);
    const timestamp = now();
    let usageLive = false;
    if (usage.status === 'fulfilled') {
      try { lastUsage = {...normalizeRateLimits(usage.value), timestamp}; usageLive = true; }
      catch {}
    }
    let tasksLive = false;
    if (tasks.status === 'fulfilled' && tasks.value.tasksStatus === 'live' &&
        Number.isSafeInteger(tasks.value.activeTasks) && tasks.value.activeTasks >= 0) {
      lastTasks = {activeTasks: tasks.value.activeTasks, timestamp}; tasksLive = true;
    }
    const usageAvailable = lastUsage && timestamp - lastUsage.timestamp < 24 * 60 * 60 * 1000;
    const tasksAvailable = lastTasks && timestamp - lastTasks.timestamp < 2 * 60 * 1000;
    const result = {
      remainingPercent: usageAvailable ? lastUsage.remainingPercent : null,
      windows: usageAvailable ? lastUsage.windows : [],
      activeTasks: tasksAvailable ? lastTasks.activeTasks : null,
      usageStatus: usageLive ? 'live' : usageAvailable ? 'stale' : 'unavailable',
      tasksStatus: tasksLive ? 'live' : tasksAvailable ? 'stale' : 'unavailable',
      updatedAt: new Date(timestamp).toISOString(),
      usageUpdatedAt: usageAvailable ? new Date(lastUsage.timestamp).toISOString() : null,
      tasksUpdatedAt: tasksAvailable ? new Date(lastTasks.timestamp).toISOString() : null,
      source: {
        usage: usageLive || usageAvailable ? 'codex-app-server-account-rate-limits' : 'unavailable',
        tasks: tasksLive || tasksAvailable ? 'readonly-sqlite-and-held-writer-locks' : 'unavailable',
        tasksScope: 'local-desktop-root-chats',
      },
    };
    if (usageLive) await save();
    return result;
  }
  return {
    readStatus() {
      if (!pending) pending = collect().finally(() => { pending = null; });
      return pending;
    },
    close() { server?.close(); },
  };
}

let singleton;
export function readStatus() {
  singleton ||= createStatusReader({cacheFile: process.env.CODEX_RECHARGE_DATA_DIR
    ? join(process.env.CODEX_RECHARGE_DATA_DIR, 'quota-cache.json') : undefined});
  return singleton.readStatus();
}
export function closeTelemetry() { singleton?.close(); singleton = undefined; }
