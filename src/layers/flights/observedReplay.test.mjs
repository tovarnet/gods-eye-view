import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPLAY_SPEED,
  observedReplayPair,
  replayCursor,
  replayWindow,
} from './observedReplay.js';

const fix = (epochMs, position = { x: epochMs }) => ({
  epochMs,
  position,
});

test('historical replay only admits actual observed intervals', () => {
  const history = [fix(1000), fix(4000), fix(9000)];
  assert.equal(observedReplayPair(history, -1), null);
  assert.equal(observedReplayPair(history, 10000), null);
  assert.equal(observedReplayPair([fix(1000)], 1000), null);
  assert.deepEqual(observedReplayPair(history, 2500), {
    a: history[0],
    b: history[1],
    t: 0.5,
  });
  assert.deepEqual(observedReplayPair(history, 9000), {
    a: history[1],
    b: history[2],
    t: 1,
  });
  assert.equal(observedReplayPair([fix(3000), fix(2000)], 2500), null);
});

test('historical replay has one shared UTC clock, fixed speed and a firm end', () => {
  const state = { active: true, fromMs: 100_000, toMs: 220_000, startedMs: 500_000 };
  assert.equal(replayCursor(state, 500_000), 100_000);
  assert.equal(replayCursor(state, 500_500), 100_000 + REPLAY_SPEED * 500);
  assert.equal(replayCursor(state, 600_000), 220_000);
  assert.equal(replayCursor({ active: false }), null);
});

test('replay eligibility requires multiple fresh observed tracks and honest time span', () => {
  const now = 1_000_000;
  const map = new Map([
    ['a', [fix(now - 90_000), fix(now - 5000)]],
    ['b', [fix(now - 80_000), fix(now - 10_000)]],
    ['c', [fix(now - 70_000), fix(now - 15_000)]],
  ]);
  assert.deepEqual(replayWindow(map, now), {
    fromMs: now - 80_000,
    toMs: now - 15_000,
    tracks: 3,
  });
  assert.equal(replayWindow(new Map([...map].slice(0, 2)), now), null);
  assert.equal(replayWindow(new Map([['a', [fix(now - 90_000)]]]), now), null);
  assert.equal(
    replayWindow(
      new Map([...map].map(([id]) => [id, [fix(1000), fix(3000)]])),
      now,
    ),
    null,
  );
});
