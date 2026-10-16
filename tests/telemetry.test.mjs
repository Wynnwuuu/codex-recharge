import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStatusReader, normalizeRateLimits} from '../telemetry/status.mjs';

const quota = (usedPercent = 44) => ({rateLimitsByLimitId: {
  codex: {limitId: 'codex', primary: {usedPercent, windowDurationMins: 10080, resetsAt: 2000000000}},
}});
const liveTasks = (activeTasks = 2) => ({activeTasks, tasksStatus: 'live'});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
}

test('selects Codex quota and uses the most restrictive real window', () => {
  const response = quota();
  response.rateLimitsByLimitId.other = {primary: {usedPercent: 99}};
  response.rateLimitsByLimitId.codex.secondary = {usedPercent: 60, windowDurationMins: 300};
  const result = normalizeRateLimits(response);
  assert.equal(result.remainingPercent, 40);
  assert.deepEqual(result.windows.map((w) => w.label), ['7d', '5h']);
  assert.equal(result.windows[1].resetsAt, null);
});

test('missing quota is unknown and percent clamps to the supported range', () => {
  assert.throws(() => normalizeRateLimits({rateLimits: {primary: {usedPercent: null}}}));
  assert.equal(normalizeRateLimits(quota(110)).remainingPercent, 0);
  assert.equal(normalizeRateLimits(quota(-10)).remainingPercent, 100);
});

test('disconnected telemetry never fabricates 0 or 100', async () => {
  const reader = createStatusReader({
    usageReader: async () => { throw new Error('fake sensitive error'); },
    taskReader: async () => { throw new Error('fake sensitive error'); },
  });
  const result = await reader.readStatus();
  assert.equal(result.remainingPercent, null);
  assert.equal(result.activeTasks, null);
  assert.equal(result.usageStatus, 'unavailable');
  assert.equal(result.tasksStatus, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});

test('marks failures stale, expires task observations before quota cache', async () => {
  let timestamp = 10000000;
  let online = true;
  const reader = createStatusReader({now: () => timestamp,
    usageReader: async () => { if (!online) throw Error(); return quota(); },
    taskReader: async () => { if (!online) throw Error(); return liveTasks(1); },
  });
  const live = await reader.readStatus();
  assert.equal(live.remainingPercent, 56);
  assert.equal(live.usageStatus, 'live');
  assert.equal(live.activeTasks, 1);
  online = false; timestamp += 1000;
  const stale = await reader.readStatus();
  assert.equal(stale.usageStatus, 'stale');
  assert.equal(stale.tasksStatus, 'stale');
  assert.equal(stale.usageUpdatedAt, live.usageUpdatedAt);
  timestamp += 120000;
  const expiredTasks = await reader.readStatus();
  assert.equal(expiredTasks.tasksStatus, 'unavailable');
  assert.equal(expiredTasks.activeTasks, null);
  assert.equal(expiredTasks.usageStatus, 'stale');
  timestamp += 24 * 60 * 60 * 1000;
  assert.equal((await reader.readStatus()).remainingPercent, null);
});

test('writes only normalized quota to private cache and coalesces concurrent reads', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'codex-telemetry-test-'));
  try {
    let calls = 0;
    const reader = createStatusReader({cacheFile: join(folder, 'cache.json'),
      usageReader: async () => { calls++; return {...quota(), accountId: 'never-cache-this'}; },
      taskReader: async () => liveTasks(),
    });
    const [first, second] = await Promise.all([reader.readStatus(), reader.readStatus()]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    const cached = await readFile(join(folder, 'cache.json'), 'utf8');
    assert.ok(!cached.includes('accountId'));
    assert.ok(!cached.includes('activeTasks'));
    assert.ok(!cached.includes('never-cache-this'));
  } finally { await rm(folder, {recursive: true, force: true}); }
});

test('task changes publish while quota is pending and do not trigger extra quota RPCs', async () => {
  const usage = deferred();
  let usageCalls = 0, active = 0, timestamp = 10000;
  const reader = createStatusReader({now: () => timestamp,
    usageReader: async () => { usageCalls++; return usage.promise; },
    taskReader: async () => liveTasks(active),
  });
  const fullRead = reader.readStatus();
  active = 1;
  const started = await reader.readTaskStatus();
  assert.equal(started.activeTasks, 1);
  assert.equal(started.tasksStatus, 'live');
  assert.equal(started.usageStatus, 'unavailable');
  timestamp += 1000; active = 0;
  assert.equal((await reader.readTaskStatus()).activeTasks, 0);
  usage.resolve(quota());
  const ready = await fullRead;
  assert.equal(ready.activeTasks, 0);
  assert.equal(ready.remainingPercent, 56);
  const usageUpdatedAt = ready.usageUpdatedAt;
  timestamp += 1000; active = 2;
  const next = await reader.readTaskStatus();
  assert.equal(next.activeTasks, 2);
  assert.equal(next.usageUpdatedAt, usageUpdatedAt);
  assert.equal(next.usageStatus, 'live');
  assert.equal(usageCalls, 1);
});

test('metric failures and completion times are independent', async () => {
  let timestamp = 10000, taskOnline = true, usageOnline = true;
  const reader = createStatusReader({now: () => timestamp,
    usageReader: async () => { if (!usageOnline) throw Error(); return quota(); },
    taskReader: async () => { if (!taskOnline) throw Error(); return liveTasks(); },
  });
  const initial = await reader.readStatus();
  timestamp += 1000; taskOnline = false;
  await reader.refreshTasks();
  assert.equal(reader.snapshot().tasksStatus, 'stale');
  assert.equal(reader.snapshot().usageStatus, 'live');
  assert.equal(reader.snapshot().tasksUpdatedAt, initial.tasksUpdatedAt);
  timestamp += 1000; usageOnline = false;
  await reader.refreshUsage();
  taskOnline = true; timestamp += 1000;
  await reader.refreshTasks();
  const recovered = reader.snapshot();
  assert.equal(recovered.tasksStatus, 'live');
  assert.equal(recovered.usageStatus, 'stale');
  assert.equal(recovered.usageUpdatedAt, initial.usageUpdatedAt);
  assert.notEqual(recovered.tasksUpdatedAt, initial.tasksUpdatedAt);
});

test('each metric has one in-flight request and quota throttling survives fast task polling', async () => {
  const tasks = deferred(), usage = deferred();
  let taskCalls = 0, usageCalls = 0, timestamp = 10000;
  const reader = createStatusReader({now: () => timestamp,
    usageReader: async () => { usageCalls++; return usage.promise; },
    taskReader: async () => { taskCalls++; return tasks.promise; },
  });
  const requests = [reader.refreshUsage(), reader.refreshUsage(),
    reader.refreshTasks(), reader.refreshTasks()];
  await Promise.resolve(); await Promise.resolve();
  assert.equal(taskCalls, 1);
  assert.equal(usageCalls, 1);
  tasks.resolve(liveTasks()); usage.resolve(quota());
  await Promise.all(requests);
  timestamp += 1000;
  await reader.refreshUsage({maxAgeMs: 30000});
  assert.equal(usageCalls, 1);
  timestamp += 30000;
  await reader.refreshUsage({maxAgeMs: 30000});
  assert.equal(usageCalls, 2);
  reader.close();
  await reader.refreshTasks();
  assert.equal(taskCalls, 1);
});

test('closing ignores late metric results', async () => {
  const usage = deferred(), tasks = deferred();
  const reader = createStatusReader({usageReader: () => usage.promise,
    taskReader: () => tasks.promise});
  const requests = [reader.refreshUsage(), reader.refreshTasks()];
  await Promise.resolve(); await Promise.resolve();
  reader.close();
  usage.resolve(quota()); tasks.resolve(liveTasks(1));
  await Promise.all(requests);
  assert.equal(reader.snapshot().usageStatus, 'unavailable');
  assert.equal(reader.snapshot().tasksStatus, 'unavailable');
});
