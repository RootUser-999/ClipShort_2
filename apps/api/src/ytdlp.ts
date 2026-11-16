import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  buildCanonicalYouTubeUrl,
  type VideoAvailability,
  type VideoInfo,
} from '../../../packages/shared/src/index.ts';
import { config, findExistingExecutable } from './config.ts';
import { logger } from './logger.ts';

export class VideoInfoError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly availability?: VideoAvailability;

  constructor(
    message: string,
    code: string,
    statusCode = 400,
    availability?: VideoAvailability,
  ) {
    super(message);
    this.name = 'VideoInfoError';
    this.code = code;
    this.statusCode = statusCode;
    this.availability = availability;
  }
}

function getCookiesArgs(): string[] {
  if (config.ytdlpCookiesFile && fs.existsSync(config.ytdlpCookiesFile)) {
    return ['--cookies', config.ytdlpCookiesFile];
  }
  return [];
}

function mapYtDlpError(stderr: string): VideoInfoError {
  const lower = stderr.toLowerCase();

  if (lower.includes('sign in to confirm') && lower.includes('not a bot')) {
    return new VideoInfoError(
      'YouTube temporarily requested bot verification for this video. If this persists, configure a server-side YTDLP_COOKIES_FILE or try another public video.',
      'YOUTUBE_BOT_CHECK',
      503,
      'unavailable',
    );
  }
  if (lower.includes('private video') || lower.includes('this video is private')) {
    return new VideoInfoError(
      'This video is private and cannot be clipped.',
      'VIDEO_PRIVATE',
      422,
      'private',
    );
  }
  if (lower.includes('members-only') || lower.includes('join this channel')) {
    return new VideoInfoError(
      'This video is for channel members only and cannot be clipped.',
      'VIDEO_MEMBERS_ONLY',
      422,
      'members_only',
    );
  }
  if (lower.includes('sign in to confirm your age') || lower.includes('age-restricted')) {
    return new VideoInfoError(
      'This video is age-restricted and cannot be clipped without server authorization.',
      'VIDEO_AGE_RESTRICTED',
      422,
      'age_restricted',
    );
  }
  if (
    lower.includes('not available in your country') ||
    lower.includes('blocked it in your country') ||
    lower.includes('geo-restricted')
  ) {
    return new VideoInfoError(
      'This video is region-blocked and unavailable from the processing server.',
      'VIDEO_REGION_BLOCKED',
      422,
      'region_blocked',
    );
  }
  if (lower.includes('copyright') || lower.includes('blocked it on copyright grounds')) {
    return new VideoInfoError(
      'This video is unavailable due to a copyright restriction.',
      'VIDEO_COPYRIGHT_BLOCKED',
      422,
      'copyright_blocked',
    );
  }
  if (lower.includes('live event will begin') || lower.includes('premieres in')) {
    return new VideoInfoError(
      'This premiere or scheduled live stream has not started yet.',
      'VIDEO_UPCOMING',
      422,
      'upcoming',
    );
  }
  if (
    lower.includes('video unavailable') ||
    lower.includes('has been removed') ||
    lower.includes('account associated with this video has been terminated')
  ) {
    return new VideoInfoError(
      'This video is unavailable or has been removed from YouTube.',
      'VIDEO_UNAVAILABLE',
      404,
      'unavailable',
    );
  }

  return new VideoInfoError(
    'Could not load this YouTube video. Verify the link is public and try again.',
    'VIDEO_FETCH_FAILED',
    502,
    'unavailable',
  );
}

interface YtDlpJsonDump {
  id?: string;
  title?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  channel?: string;
  uploader?: string;
  is_live?: boolean;
  live_status?: string;
  availability?: string;
  playable_in_embed?: boolean;
}

let ensureYtDlpPromise: Promise<string> | null = null;
let verifiedYtDlpPath: string | null = null;

async function canRunYtDlp(binPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(binPath, ['--version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 5000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export async function ensureYtDlpBin(): Promise<string> {
  if (verifiedYtDlpPath) return verifiedYtDlpPath;

  const existing = findExistingExecutable([
    config.ytDlpBin,
    path.join(config.tempDir, 'bin', 'yt-dlp'),
  ]);
  if (existing && (await canRunYtDlp(existing))) {
    verifiedYtDlpPath = existing;
    return existing;
  }

  if (!ensureYtDlpPromise) {
    ensureYtDlpPromise = (async () => {
      const targetPath = path.join(config.tempDir, 'bin', 'yt-dlp');
      await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
      const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Failed to download yt-dlp binary (${resp.status})`);
      }
      const bytes = Buffer.from(await resp.arrayBuffer());
      await fsPromises.writeFile(targetPath, bytes);
      await fsPromises.chmod(targetPath, 0o755);
      logger.info({ targetPath }, 'Bootstrapped standalone yt-dlp binary');
      verifiedYtDlpPath = targetPath;
      return targetPath;
    })().catch((err) => {
      ensureYtDlpPromise = null;
      throw err;
    });
  }

  return ensureYtDlpPromise;
}

export async function fetchVideoInfo(
  videoId: string,
  initialTimestampSec?: number,
  timeoutMs = 30000,
): Promise<VideoInfo> {
  const ytDlpBin = await ensureYtDlpBin();
  const canonicalUrl = buildCanonicalYouTubeUrl(videoId);
  const args = [
    ...getCookiesArgs(),
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    '--socket-timeout',
    '15',
    canonicalUrl,
  ];

  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const child = spawn(ytDlpBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new VideoInfoError('Timed out while fetching video metadata from YouTube.', 'VIDEO_TIMEOUT', 504));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    },
  );

  if (result.code !== 0 || !result.stdout.trim()) {
    logger.warn({ videoId, code: result.code, stderr: result.stderr.slice(0, 600) }, 'yt-dlp metadata fetch failed');
    throw mapYtDlpError(result.stderr);
  }

  let data: YtDlpJsonDump;
  try {
    data = JSON.parse(result.stdout) as YtDlpJsonDump;
  } catch (err) {
    logger.error({ err, videoId }, 'Failed to parse yt-dlp JSON output');
    throw new VideoInfoError('Received unreadable metadata from YouTube.', 'VIDEO_PARSE_ERROR', 502);
  }

  if (data.live_status === 'is_upcoming') {
    throw new VideoInfoError(
      'Upcoming premieres and scheduled live streams cannot be clipped until they finish.',
      'VIDEO_UPCOMING',
      422,
      'upcoming',
    );
  }

  if (data.is_live === true || data.live_status === 'is_live') {
    throw new VideoInfoError(
      'Active live streams cannot be clipped. Once the stream ends and becomes a VOD, you can clip it.',
      'VIDEO_LIVE',
      422,
      'live',
    );
  }

  if (data.playable_in_embed === false) {
    throw new VideoInfoError(
      'The creator disabled embedding on this video, so it cannot be previewed or clipped here.',
      'VIDEO_EMBED_DISABLED',
      422,
      'embed_disabled',
    );
  }

  const duration = typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : 0;
  if (duration <= 0) {
    throw new VideoInfoError('Video duration could not be determined.', 'VIDEO_NO_DURATION', 422);
  }

  if (duration > config.maxVideoDurationSec) {
    const maxHours = Math.round((config.maxVideoDurationSec / 3600) * 10) / 10;
    throw new VideoInfoError(
      `This video exceeds the maximum supported length of ${maxHours} hours.`,
      'VIDEO_TOO_LONG',
      422,
    );
  }

  const bestThumb =
    data.thumbnail ||
    data.thumbnails?.slice().reverse().find((t) => t.url)?.url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const availability: VideoAvailability =
    data.availability === 'unlisted' ? 'unlisted' : duration < 60 ? 'short' : 'public';

  return {
    videoId,
    title: data.title?.trim() || `YouTube Video ${videoId}`,
    duration,
    thumbnail: bestThumb,
    channel: data.channel?.trim() || data.uploader?.trim() || 'YouTube Channel',
    isLive: false,
    availability,
    initialTimestampSec,
  };
}

export interface DownloadSectionOptions {
  videoId: string;
  startSec: number;
  endSec: number;
  durationSec?: number;
  jobDir: string;
  onProgress: (pct: number) => void;
  signal: AbortSignal;
}

export interface DownloadSectionResult {
  filePath: string;
  trimOffsetSec: number;
}

export async function downloadVideoSection(
  options: DownloadSectionOptions,
): Promise<DownloadSectionResult> {
  const { videoId, startSec, endSec, durationSec, jobDir, onProgress, signal } = options;
  const canonicalUrl = buildCanonicalYouTubeUrl(videoId);

  const safetyBufferSec = 4;
  const fetchStart = Math.max(0, startSec - safetyBufferSec);
  const fetchEnd = durationSec ? Math.min(durationSec, endSec + safetyBufferSec) : endSec + safetyBufferSec;
  const trimOffsetSec = Math.max(0, startSec - fetchStart);

  const outputTemplate = path.join(jobDir, 'source.%(ext)s');
  const sectionSpec = `*${fetchStart.toFixed(2)}-${fetchEnd.toFixed(2)}`;

  // Prefer <=1080p video+audio, gracefully fall back to any available video+audio or best format
  const formatSelector =
    'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/best';

  const args = [
    ...getCookiesArgs(),
    '--no-playlist',
    '--no-part',
    '--newline',
    '--socket-timeout',
    '20',
    '-f',
    formatSelector,
    '--download-sections',
    sectionSpec,
    '--force-keyframes-at-cuts',
    '--merge-output-format',
    'mp4',
    '-o',
    outputTemplate,
    canonicalUrl,
  ];

  const ytDlpBin = await ensureYtDlpBin();

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Job aborted'));
      return;
    }

    const child = spawn(ytDlpBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    const onAbort = () => {
      child.kill('SIGKILL');
      reject(new Error('Job timed out or cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const parseLine = (line: string) => {
      const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (match) {
        const pct = Number.parseFloat(match[1]);
        if (Number.isFinite(pct)) {
          onProgress(Math.min(100, Math.max(0, pct)));
        }
      }
    };

    let stdoutBuf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) parseLine(line);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (code !== 0) {
        logger.error({ videoId, code, stderr: stderr.slice(-1000) }, 'yt-dlp section download failed');
        const mapped = mapYtDlpError(stderr);
        reject(mapped);
        return;
      }
      resolve();
    });
  });

  const files = await fsPromises.readdir(jobDir);
  const downloaded = files.find((f) => f.startsWith('source.') && !f.endsWith('.part'));
  if (!downloaded) {
    throw new VideoInfoError('Download completed but no media file was produced.', 'DOWNLOAD_MISSING_FILE', 500);
  }

  return {
    filePath: path.join(jobDir, downloaded),
    trimOffsetSec,
  };
}

export function startYtDlpAutoUpdater(): () => void {
  if (!config.autoUpdateYtdlp) {
    return () => {};
  }

  const runUpdate = async () => {
    let ytDlpBin: string;
    try {
      ytDlpBin = await ensureYtDlpBin();
    } catch (err) {
      logger.info(
        { reason: err instanceof Error ? err.message : 'unavailable' },
        'Skipping yt-dlp auto-update; binary unavailable',
      );
      return;
    }

    const child = spawn(ytDlpBin, ['-U'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.on('close', (code) => {
      logger.info({ code, output: out.trim() }, 'yt-dlp auto-update check finished');
    });
    child.on('error', (err) => {
      logger.info({ reason: err.message }, 'yt-dlp auto-update check skipped');
    });
  };

  void runUpdate();
  const interval = setInterval(() => {
    void runUpdate();
  }, 24 * 60 * 60 * 1000);
  interval.unref();
  return () => clearInterval(interval);
}
