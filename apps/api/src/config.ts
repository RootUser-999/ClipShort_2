import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

function parseIntEnv(key: string, fallback: number, min = 1): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function parseBoolEnv(key: string, fallback = false): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function parseCliPort(): number | null {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' && i + 1 < argv.length) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
    }
  }
  return null;
}

function resolvePort(): { port: number; warning?: string } {
  const rawEnv = process.env.PORT?.trim();
  if (rawEnv) {
    const parsed = Number.parseInt(rawEnv, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return { port: parsed };
    }
    return {
      port: 3000,
      warning: `Invalid PORT="${rawEnv}" environment variable; falling back to 3000`,
    };
  }
  const cliPort = parseCliPort();
  if (cliPort !== null) {
    return { port: cliPort };
  }
  return { port: 3000 };
}

export function findExistingExecutable(
  candidates: string[],
  binaryName = 'yt-dlp',
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue searching
    }
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const full = path.join(dir, binaryName);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // continue
    }
  }
  return null;
}

function resolveYtDlpPath(tempDir: string): string {
  const configured = process.env.YTDLP_PATH?.trim();
  if (configured) return configured;

  const found = findExistingExecutable(
    [
      path.resolve(process.cwd(), '.bin', 'yt-dlp'),
      path.resolve(import.meta.dirname, '../../../.bin/yt-dlp'),
      path.join(tempDir, 'bin', 'yt-dlp'),
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
    ],
    'yt-dlp',
  );
  return found || path.join(tempDir, 'bin', 'yt-dlp');
}

function resolveBinaryPath(envKey: string, defaultName: string): string {
  const configured = process.env[envKey]?.trim();
  if (configured) return configured;
  return (
    findExistingExecutable([`/usr/local/bin/${defaultName}`, `/usr/bin/${defaultName}`], defaultName) ||
    defaultName
  );
}

const portResolution = resolvePort();
const resolvedTempDir = process.env.TEMP_DIR?.trim() || '/tmp/clipshort';

export const config = {
  port: portResolution.port,
  portWarning: portResolution.warning,
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  appOrigin:
    process.env.APP_ORIGIN?.trim() ||
    process.env.APP_URL?.trim() ||
    `http://localhost:${portResolution.port}`,
  tempDir: resolvedTempDir,
  maxVideoDurationSec: parseIntEnv('MAX_VIDEO_DURATION', 43200), // 12h default
  maxClipDurationSec: parseIntEnv('MAX_CLIP_DURATION', 60),
  minClipDurationSec: parseIntEnv('MIN_CLIP_DURATION', 1),
  jobTimeoutMs: parseIntEnv('JOB_TIMEOUT_MS', 300000), // 5m
  concurrency: parseIntEnv('CONCURRENCY', 2),
  retentionMs: parseIntEnv('RETENTION_MS', 1800000), // 30m
  minFreeDiskMb: parseIntEnv('MIN_FREE_DISK_MB', 500, 10),
  redisUrl: process.env.REDIS_URL?.trim() || '',
  ytDlpBin: resolveYtDlpPath(resolvedTempDir),
  ffmpegBin: resolveBinaryPath('FFMPEG_PATH', 'ffmpeg'),
  ffprobeBin: resolveBinaryPath('FFPROBE_PATH', 'ffprobe'),
  ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE?.trim() || '',
  autoUpdateYtdlp: parseBoolEnv('AUTO_UPDATE_YTDLP', false),
  rateLimitInfoPerMin: parseIntEnv('RATE_LIMIT_INFO_PER_MIN', 10),
  rateLimitClipsPerHour: parseIntEnv('RATE_LIMIT_CLIPS_PER_HOUR', 5),
  turnstileEnabled: parseBoolEnv('TURNSTILE_ENABLED', false),
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY?.trim() || '',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY?.trim() || '',
  allowOnlyCcOrOwn: parseBoolEnv('ALLOW_ONLY_CC_OR_OWN', false),
  dmcaContactEmail: process.env.DMCA_CONTACT_EMAIL?.trim() || 'dmca@clipshort.example',
};

export interface StartupValidationLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export function validateStartupConfig(log: StartupValidationLogger): void {
  if (config.portWarning) {
    log.warn({ port: config.port }, config.portWarning);
  }

  if (config.appOrigin) {
    try {
      new URL(config.appOrigin);
    } catch {
      log.warn({ appOrigin: config.appOrigin }, 'APP_ORIGIN is not a valid URL; origin checks may ignore it');
    }
  }

  fs.mkdirSync(config.tempDir, { recursive: true });
  fs.accessSync(config.tempDir, fs.constants.R_OK | fs.constants.W_OK);

  const ffmpegAvailable = Boolean(findExistingExecutable([config.ffmpegBin], 'ffmpeg'));
  const ffprobeAvailable = Boolean(findExistingExecutable([config.ffprobeBin], 'ffprobe'));
  const ytDlpAvailable = Boolean(findExistingExecutable([config.ytDlpBin], 'yt-dlp'));

  if (!ffmpegAvailable || !ffprobeAvailable) {
    log.warn(
      { ffmpegBin: config.ffmpegBin, ffprobeBin: config.ffprobeBin },
      'ffmpeg/ffprobe binary not found at startup; rendering will fail until available',
    );
  }

  if (config.ytdlpCookiesFile && !fs.existsSync(config.ytdlpCookiesFile)) {
    log.warn(
      { ytdlpCookiesConfigured: true },
      'YTDLP_COOKIES_FILE is configured but the file does not exist; continuing without cookies',
    );
  }

  log.info(
    {
      env: config.nodeEnv,
      port: config.port,
      tempDir: config.tempDir,
      redisConfigured: Boolean(config.redisUrl),
      ffmpegAvailable,
      ffprobeAvailable,
      ytDlpAvailable,
      turnstileEnabled: config.turnstileEnabled,
    },
    'Startup configuration validated',
  );
}
