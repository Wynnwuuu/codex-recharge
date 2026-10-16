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
