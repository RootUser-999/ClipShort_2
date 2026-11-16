import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSelectionMs,
  formatMsToTimecode,
  getInitialSelectionMs,
  moveWindowMs,
  parseTimecodeToMs,
  resizeEndMs,
  resizeStartMs,
} from '../packages/shared/src/time.ts';

test('getInitialSelectionMs clamps short videos and respects t= timestamp', () => {
  assert.deepEqual(getInitialSelectionMs(35), { startMs: 0, endMs: 35000 });
  assert.deepEqual(getInitialSelectionMs(300), { startMs: 0, endMs: 60000 });
  assert.deepEqual(getInitialSelectionMs(300, 90), { startMs: 90000, endMs: 150000 });
  // Near end of video: leaves at least 1s
  assert.deepEqual(getInitialSelectionMs(120, 119.5), { startMs: 119000, endMs: 120000 });
});

test('moveWindowMs preserves window length and clamps at 0 and duration without wrapping', () => {
  const durationMs = 7200_000; // 2 hours
  assert.deepEqual(moveWindowMs(10_000, 40_000, -20_000, durationMs), {
    startMs: 0,
    endMs: 30_000,
  });
  assert.deepEqual(moveWindowMs(7180_000, 7200_000, 50_000, durationMs), {
    startMs: 7180_000,
    endMs: 7200_000,
  });
  assert.deepEqual(moveWindowMs(100_000, 145_000, 15_000, durationMs), {
    startMs: 115_000,
    endMs: 160_000,
  });
});

test('resizeStartMs and resizeEndMs enforce 1s min, 60s max, and video bounds', () => {
  const durationMs = 180_000;
  // Cannot push start past end - 1s
  assert.deepEqual(resizeStartMs(59_500, 60_000, durationMs), {
    startMs: 59_000,
    endMs: 60_000,
  });
  // Cannot stretch longer than 60s
  assert.deepEqual(resizeStartMs(0, 90_000, durationMs), {
    startMs: 30_000,
    endMs: 90_000,
  });
  // Cannot pull end before start + 1s
  assert.deepEqual(resizeEndMs(40_000, 40_200, durationMs), {
    startMs: 40_000,
    endMs: 41_000,
  });
  // Cannot stretch end beyond start + 60s or duration
  assert.deepEqual(resizeEndMs(40_000, 150_000, durationMs), {
    startMs: 40_000,
    endMs: 100_000,
  });
  assert.deepEqual(resizeEndMs(160_000, 200_000, durationMs), {
    startMs: 160_000,
    endMs: 180_000,
  });
});

test('clampSelectionMs enforces invariants on arbitrary inputs', () => {
  assert.deepEqual(clampSelectionMs(-5000, 90_000, 120_000), {
    startMs: 0,
    endMs: 60_000,
  });
  assert.deepEqual(clampSelectionMs(50_000, 50_100, 120_000), {
    startMs: 50_000,
    endMs: 51_000,
  });
});

test('timecode format and parse roundtrip cleanly', () => {
  assert.equal(formatMsToTimecode(0), '00:00');
  assert.equal(formatMsToTimecode(90_000), '01:30');
  assert.equal(formatMsToTimecode(3723_000), '01:02:03');
  assert.equal(parseTimecodeToMs('01:30'), 90_000);
  assert.equal(parseTimecodeToMs('01:02:03'), 3723_000);
  assert.equal(parseTimecodeToMs('45'), 45_000);
  assert.equal(parseTimecodeToMs('01:75'), null);
  assert.equal(parseTimecodeToMs('abc'), null);
});
