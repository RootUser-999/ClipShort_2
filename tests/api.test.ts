import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createBackendApp } from '../apps/api/src/app.ts';

test('Express API endpoints enforce validation, security headers, and error codes', async () => {
  const { app, shutdown } = await createBackendApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));

  try {
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    // 1. Health check
    const healthResp = await fetch(`${base}/api/health`);
    assert.equal(healthResp.status, 200);
    const healthData = (await healthResp.json()) as {
      ok: boolean;
      status: string;
      queueMode: string;
      uptimeSec: number;
    };
    assert.equal(healthData.ok, true);
    assert.equal(healthData.status, 'healthy');
    assert.ok(healthData.queueMode === 'memory' || healthData.queueMode === 'redis');
    assert.equal(typeof healthData.uptimeSec, 'number');
    assert.ok(healthResp.headers.get('x-request-id'));
    const csp = healthResp.headers.get('content-security-policy') ?? '';
    assert.ok(csp.includes('frame-ancestors'));
    assert.ok(!csp.includes('upgrade-insecure-requests'));
    assert.equal(healthResp.headers.get('x-frame-options'), null);

    // 1b. Unknown API endpoint returns JSON 404
    const notFoundResp = await fetch(`${base}/api/nonexistent-route`);
    assert.equal(notFoundResp.status, 404);
    const notFoundData = (await notFoundResp.json()) as { code: string };
    assert.equal(notFoundData.code, 'NOT_FOUND');

    // 2. Public config
    const cfgResp = await fetch(`${base}/api/config`);
    assert.equal(cfgResp.status, 200);
    const cfg = (await cfgResp.json()) as { maxClipDurationSec: number; minClipDurationSec: number };
    assert.equal(cfg.maxClipDurationSec, 60);
    assert.equal(cfg.minClipDurationSec, 1);

    // 3. Reject non-YouTube / SSRF URLs on /api/video/info
    const badUrlResp = await fetch(`${base}/api/video/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }),
    });
    assert.equal(badUrlResp.status, 400);
    const badUrlBody = (await badUrlResp.json()) as { code: string };
    assert.equal(badUrlBody.code, 'INVALID_YOUTUBE_URL');

    // 4. Reject /api/clips when rightsConfirmed is false
    const noRightsResp = await fetch(`${base}/api/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: 'aqz-KE-bpKQ',
        start: 0,
        end: 10,
        framing: 'center',
        rightsConfirmed: false,
      }),
    });
    assert.equal(noRightsResp.status, 400);

    // 5. Reject /api/clips > 60s
    const tooLongResp = await fetch(`${base}/api/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: 'aqz-KE-bpKQ',
        start: 0,
        end: 75,
        framing: 'center',
        rightsConfirmed: true,
      }),
    });
    assert.equal(tooLongResp.status, 400);

    // 6. Expired / unknown jobId returns friendly message
    const missingJobResp = await fetch(`${base}/api/clips/00000000-0000-4000-8000-000000000000`);
    assert.equal(missingJobResp.status, 404);
    const missingJobBody = (await missingJobResp.json()) as { error: string };
    assert.match(missingJobBody.error, /expired/i);

    // 7. Reject path traversal jobId
    const badJobIdResp = await fetch(`${base}/api/clips/not-a-uuid/download`);
    assert.equal(badJobIdResp.status, 400);
  } finally {
    await shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
