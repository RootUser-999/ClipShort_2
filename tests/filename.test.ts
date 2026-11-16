import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClipFilename, sanitizeFilenameSegment } from '../packages/shared/src/filename.ts';

test('sanitizeFilenameSegment strips emojis, path traversal, and control characters', () => {
  assert.equal(sanitizeFilenameSegment('My 🔥 Cool / Video \\ Title!'), 'My-Cool-Video-Title');
  assert.equal(sanitizeFilenameSegment('../../etc/passwd\x00\x1f'), 'etc-passwd');
  assert.equal(sanitizeFilenameSegment('🔥🔥🔥///'), 'clip');
  assert.equal(sanitizeFilenameSegment('Café & Résumé: Part 1'), 'Cafe-Resume-Part-1');
  assert.ok(sanitizeFilenameSegment('A'.repeat(200)).length <= 60);
});

test('buildClipFilename formats <sanitized-title>_<start>-<end>.mp4', () => {
  assert.equal(
    buildClipFilename('Big Buck Bunny (4K) 🚀', 65, 125),
    'Big-Buck-Bunny-4K_01m05s-02m05s.mp4',
  );
  assert.equal(
    buildClipFilename('Podcast Episode', 3661, 3720),
    'Podcast-Episode_01h01m01s-01h02m00s.mp4',
  );
});
