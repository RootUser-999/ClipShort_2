import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeUrl, buildCanonicalYouTubeUrl } from '../packages/shared/src/youtubeUrl.ts';

const VALID_CASES: Array<{ input: string; expectedId: string; expectedT?: number }> = [
  { input: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'http://www.youtube.com/watch?v=aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://youtube.com/watch?v=aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'youtube.com/watch?v=aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'www.youtube.com/watch?v=aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: '  https://www.youtube.com/watch?v=aqz-KE-bpKQ  ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://m.youtube.com/watch?v=aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'm.youtube.com/watch?v=aqz-KE-bpKQ&t=90s', expectedId: 'aqz-KE-bpKQ', expectedT: 90 },
  { input: 'https://music.youtube.com/watch?v=aqz-KE-bpKQ&si=abc123', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://youtu.be/aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'youtu.be/aqz-KE-bpKQ?si=xyz987', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://youtu.be/aqz-KE-bpKQ?t=45', expectedId: 'aqz-KE-bpKQ', expectedT: 45 },
  { input: 'https://youtu.be/aqz-KE-bpKQ?t=1m30s', expectedId: 'aqz-KE-bpKQ', expectedT: 90 },
  { input: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=1h2m3s', expectedId: 'aqz-KE-bpKQ', expectedT: 3723 },
  { input: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PL123&index=2', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://www.youtube.com/shorts/aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'youtube.com/shorts/aqz-KE-bpKQ?feature=share', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://www.youtube.com/embed/aqz-KE-bpKQ?start=33', expectedId: 'aqz-KE-bpKQ', expectedT: 33 },
  { input: 'https://www.youtube.com/live/aqz-KE-bpKQ?si=test', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ', expectedId: 'aqz-KE-bpKQ' },
  { input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=12s', expectedId: 'dQw4w9WgXcQ', expectedT: 12 },
  { input: 'https://www.youtube.com/watch?feature=player_embedded&v=dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
  { input: 'https://www.youtube.com/v/dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
];

const INVALID_CASES: string[] = [
  '',
  '   ',
  'not a url at all',
  'https://vimeo.com/123456789',
  'https://tiktok.com/@user/video/123456',
  'https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ',
  'https://notyoutube.com/watch?v=aqz-KE-bpKQ',
  'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
  'https://www.youtube.com/@mkbhd',
  'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ',
  'https://www.youtube.com/c/Veritasium',
  'https://www.youtube.com/watch?v=shortid',
  'https://www.youtube.com/watch?v=waytoolongvideoid123',
  'https://www.youtube.com/watch?v=bad$char!12',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,<script>alert(1)</script>',
  'ftp://youtube.com/watch?v=aqz-KE-bpKQ',
  'https://www.youtube.com/watch',
  'https://youtu.be/',
  'https://www.youtube.com/shorts/',
  'https://www.youtube.com/watch?v=aqz-KE-bpKQ extra text',
];

test('parses all valid YouTube URL variants and timestamps', () => {
  for (const tc of VALID_CASES) {
    const res = parseYouTubeUrl(tc.input);
    assert.equal(res.valid, true, `Expected valid for: ${tc.input}`);
    if (res.valid) {
      assert.equal(res.videoId, tc.expectedId);
      assert.equal(res.canonicalUrl, `https://www.youtube.com/watch?v=${tc.expectedId}`);
      if (tc.expectedT !== undefined) {
        assert.equal(res.initialTimestampSec, tc.expectedT);
      }
    }
  }
});

test('rejects all invalid, non-YouTube, playlist, and unsafe scheme URLs', () => {
  for (const input of INVALID_CASES) {
    const res = parseYouTubeUrl(input);
    assert.equal(res.valid, false, `Expected invalid for: ${input}`);
  }
});

test('buildCanonicalYouTubeUrl enforces strict 11-char ID', () => {
  assert.equal(buildCanonicalYouTubeUrl('aqz-KE-bpKQ'), 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  assert.throws(() => buildCanonicalYouTubeUrl('aqz-KE-bpKQ; rm -rf /'));
  assert.throws(() => buildCanonicalYouTubeUrl('../etc/passwd'));
});
