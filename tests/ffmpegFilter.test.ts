import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFfmpegFilterGraph } from '../packages/shared/src/ffmpegFilter.ts';

test('builds 1080x1920 center crop filter and caps fps at 30', () => {
  const res = buildFfmpegFilterGraph({
    framing: 'center',
    sourceFps: 60,
    hasAudio: true,
  });
  assert.equal(res.targetFps, 30);
  assert.ok(res.filterComplex.includes('fps=30'));
  assert.ok(res.filterComplex.includes('scale=1080:1920:force_original_aspect_ratio=increase'));
  assert.ok(res.filterComplex.includes('crop=1080:1920'));
  assert.ok(res.filterComplex.includes('format=yuv420p[vout]'));
  assert.deepEqual(res.audioMapArgs, ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ac', '2']);
});

test('preserves lower source fps and handles no-audio streams', () => {
  const res = buildFfmpegFilterGraph({
    framing: 'center',
    sourceFps: 24,
    hasAudio: false,
  });
  assert.equal(res.targetFps, 24);
  assert.ok(res.filterComplex.includes('fps=24'));
  assert.deepEqual(res.audioMapArgs, ['-an']);
});

test('builds custom horizontal crop filter clamped between 0 and 1', () => {
  const res = buildFfmpegFilterGraph({
    framing: 'custom',
    cropX: 1.5,
    sourceFps: 30,
    hasAudio: true,
  });
  assert.ok(res.filterComplex.includes('1.0000'));
  assert.ok(res.filterComplex.includes('crop=1080:1920:'));
});

test('builds blurred background split/overlay filter', () => {
  const res = buildFfmpegFilterGraph({
    framing: 'blur',
    sourceFps: 30,
    hasAudio: true,
  });
  assert.ok(res.filterComplex.includes('split=2[bg][fg]'));
  assert.ok(res.filterComplex.includes('boxblur='));
  assert.ok(res.filterComplex.includes('overlay=(W-w)/2:(H-h)/2'));
});
