import { spawn } from 'node:child_process';
import {
  buildFfmpegFilterGraph,
  type FramingMode,
} from '../../../packages/shared/src/index.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';

export interface MediaProbeInfo {
  hasVideo: boolean;
  hasAudio: boolean;
  fps: number;
  durationSec: number;
  width: number;
  height: number;
}

function parseFrameRate(raw?: string): number {
  if (!raw) return 30;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number.parseFloat(parts[0]);
    const den = Number.parseFloat(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return num / den;
    }
  }
  const single = Number.parseFloat(raw);
  return Number.isFinite(single) && single > 0 ? single : 30;
}

export async function probeMedia(filePath: string): Promise<MediaProbeInfo> {
  const args = [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.ffprobeBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve(stdout);
    });
  });

  const parsed = JSON.parse(output) as {
    streams?: Array<{
      codec_type?: string;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      width?: number;
      height?: number;
    }>;
    format?: { duration?: string };
  };

  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const durationSec = Number.parseFloat(parsed.format?.duration ?? '0') || 0;

  return {
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
    fps: parseFrameRate(videoStream?.avg_frame_rate || videoStream?.r_frame_rate),
    durationSec,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
  };
}

function parseOutTimeToSec(outTime: string): number | null {
  // Format: HH:MM:SS.xxxxxx
  const match = outTime.trim().match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  const s = Number.parseFloat(match[3]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

export interface RenderClipOptions {
  inputPath: string;
  outputPath: string;
  trimOffsetSec: number;
  clipDurationSec: number;
  framing: FramingMode;
  cropX?: number;
  onProgress: (pct: number) => void;
  signal: AbortSignal;
}

export async function renderVerticalClip(options: RenderClipOptions): Promise<void> {
  const {
    inputPath,
    outputPath,
    trimOffsetSec,
    clipDurationSec,
    framing,
    cropX,
    onProgress,
    signal,
  } = options;

  const probe = await probeMedia(inputPath);
  if (!probe.hasVideo) {
    throw new Error('This media format does not contain a video stream (audio-only formats cannot be converted to 9:16 video).');
  }

  // Clamp trimOffsetSec in case downloaded section is shorter than buffered expectation
  const safeOffset =
    probe.durationSec > clipDurationSec
      ? Math.min(trimOffsetSec, Math.max(0, probe.durationSec - clipDurationSec))
      : 0;

  const filter = buildFfmpegFilterGraph({
    framing,
    cropX,
    sourceFps: probe.fps,
    hasAudio: probe.hasAudio,
  });

  const args = [
    '-y',
    '-ss',
    safeOffset.toFixed(3),
    '-i',
    inputPath,
    '-t',
    clipDurationSec.toFixed(3),
    '-filter_complex',
    filter.filterComplex,
    '-map',
    filter.videoMapLabel,
    ...filter.audioMapArgs,
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level:v',
    '4.1',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Job aborted'));
      return;
    }

    const child = spawn(config.ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    const onAbort = () => {
      child.kill('SIGKILL');
      reject(new Error('Rendering timed out or cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    let stdoutBuf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('out_time=')) {
          const sec = parseOutTimeToSec(line.slice('out_time='.length));
          if (sec !== null && clipDurationSec > 0) {
            const pct = Math.min(99, Math.max(0, (sec / clipDurationSec) * 100));
            onProgress(pct);
          }
        } else if (line.trim() === 'progress=end') {
          onProgress(100);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8000) {
        stderr = stderr.slice(-4000);
      }
    });

    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (code !== 0) {
        logger.error({ code, stderr: stderr.slice(-1200) }, 'ffmpeg render failed');
        reject(new Error('Video rendering failed during encoding. Please try another clip range.'));
        return;
      }
      onProgress(100);
      resolve();
    });
  });
}
