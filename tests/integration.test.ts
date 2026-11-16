import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeMedia, renderVerticalClip } from '../apps/api/src/ffmpeg.ts';
import { downloadVideoSection, fetchVideoInfo } from '../apps/api/src/ytdlp.ts';

async function generateSynthetic16x9Video(outputPath: string, durationSec = 6, withAudio = true): Promise<void> {
  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=duration=${durationSec}:size=1280x720:rate=30`,
    ...(withAudio
      ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSec}`]
      : []),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    ...(withAudio ? ['-c:a', 'aac', '-shortest'] : ['-an']),
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`Synthetic video generation failed: ${stderr}`));
      else resolve();
    });
  });
}

test('ffmpeg renders 1080x1920 H.264/AAC MP4 across center, custom, blur, and no-audio modes within ±0.3s', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipshort-int-'));
  try {
    const srcWithAudio = path.join(workDir, 'src_audio.mp4');
    const srcNoAudio = path.join(workDir, 'src_silent.mp4');
    await generateSynthetic16x9Video(srcWithAudio, 6, true);
    await generateSynthetic16x9Video(srcNoAudio, 5, false);

    const controller = new AbortController();

    // 1. Center crop
    const outCenter = path.join(workDir, 'out_center.mp4');
    await renderVerticalClip({
      inputPath: srcWithAudio,
      outputPath: outCenter,
      trimOffsetSec: 1.0,
      clipDurationSec: 3.0,
      framing: 'center',
      onProgress: () => {},
      signal: controller.signal,
    });
    const probeCenter = await probeMedia(outCenter);
    assert.equal(probeCenter.width, 1080);
    assert.equal(probeCenter.height, 1920);
    assert.equal(probeCenter.hasVideo, true);
    assert.equal(probeCenter.hasAudio, true);
    assert.ok(Math.abs(probeCenter.durationSec - 3.0) <= 0.3, `Expected ~3.0s, got ${probeCenter.durationSec}`);

    // 2. Custom crop
    const outCustom = path.join(workDir, 'out_custom.mp4');
    await renderVerticalClip({
      inputPath: srcWithAudio,
      outputPath: outCustom,
      trimOffsetSec: 0.5,
      clipDurationSec: 2.5,
      framing: 'custom',
      cropX: 0.25,
      onProgress: () => {},
      signal: controller.signal,
    });
    const probeCustom = await probeMedia(outCustom);
    assert.equal(probeCustom.width, 1080);
    assert.equal(probeCustom.height, 1920);
    assert.ok(Math.abs(probeCustom.durationSec - 2.5) <= 0.3);

    // 3. Blurred background
    const outBlur = path.join(workDir, 'out_blur.mp4');
    await renderVerticalClip({
      inputPath: srcWithAudio,
      outputPath: outBlur,
      trimOffsetSec: 1.0,
      clipDurationSec: 2.0,
      framing: 'blur',
      onProgress: () => {},
      signal: controller.signal,
    });
    const probeBlur = await probeMedia(outBlur);
    assert.equal(probeBlur.width, 1080);
    assert.equal(probeBlur.height, 1920);
    assert.ok(Math.abs(probeBlur.durationSec - 2.0) <= 0.3);

    // 4. Video with no audio track
    const outSilent = path.join(workDir, 'out_silent.mp4');
    await renderVerticalClip({
      inputPath: srcNoAudio,
      outputPath: outSilent,
      trimOffsetSec: 0.5,
      clipDurationSec: 2.0,
      framing: 'center',
      onProgress: () => {},
      signal: controller.signal,
    });
    const probeSilent = await probeMedia(outSilent);
    assert.equal(probeSilent.width, 1080);
    assert.equal(probeSilent.height, 1920);
    assert.equal(probeSilent.hasVideo, true);
    assert.equal(probeSilent.hasAudio, false);
    assert.ok(Math.abs(probeSilent.durationSec - 2.0) <= 0.3);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('real YouTube CC clip pipeline (yt-dlp + ffmpeg + ffprobe) produces valid 1080x1920 MP4', async (t) => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipshort-yt-'));
  try {
    // "Me at the zoo" (19s public historic video) or Big Buck Bunny CC
    const videoId = 'jNQXAC9IVRw';
    let info;
    try {
      info = await fetchVideoInfo(videoId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('bot verification') || msg.includes('Sign in')) {
        t.skip('Skipping live YouTube download in CI/datacenter IP due to bot-check without cookies');
        return;
      }
      throw err;
    }

    assert.equal(info.videoId, videoId);
    assert.ok(info.duration > 0);

    const controller = new AbortController();
    const dl = await downloadVideoSection({
      videoId,
      startSec: 2,
      endSec: 6,
      durationSec: info.duration,
      jobDir: workDir,
      onProgress: () => {},
      signal: controller.signal,
    });

    const outPath = path.join(workDir, 'yt_clip.mp4');
    await renderVerticalClip({
      inputPath: dl.filePath,
      outputPath: outPath,
      trimOffsetSec: dl.trimOffsetSec,
      clipDurationSec: 4,
      framing: 'blur',
      onProgress: () => {},
      signal: controller.signal,
    });

    const probe = await probeMedia(outPath);
    assert.equal(probe.width, 1080);
    assert.equal(probe.height, 1920);
    assert.equal(probe.hasVideo, true);
    assert.ok(Math.abs(probe.durationSec - 4) <= 0.3, `Expected ~4s, got ${probe.durationSec}`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});
