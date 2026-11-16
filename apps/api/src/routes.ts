import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import express, { type Request, type Response } from 'express';
import {
  CreateClipRequestSchema,
  JobIdParamSchema,
  parseYouTubeUrl,
  VideoInfoRequestSchema,
  type PublicAppConfig,
  type VideoInfo,
} from '../../../packages/shared/src/index.ts';
import { config } from './config.ts';
import {
  createClipsRateLimiter,
  createInfoRateLimiter,
  verifyTurnstileMiddleware,
} from './middleware.ts';
import type { ClipQueueManager } from './queue.ts';
import { fetchVideoInfo, VideoInfoError } from './ytdlp.ts';

interface CachedVideoInfo {
  info: VideoInfo;
  expiresAt: number;
}

export function createApiRouter(queue: ClipQueueManager): express.Router {
  const router = express.Router();
  const videoCache = new Map<string, CachedVideoInfo>();

  const infoLimiter = createInfoRateLimiter(queue.getRedisClient());
  const clipsLimiter = createClipsRateLimiter(queue.getRedisClient());

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      status: 'healthy',
      queueMode: queue.isUsingRedis() ? 'redis' : 'memory',
      env: config.nodeEnv,
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/config', (_req: Request, res: Response) => {
    const publicConfig: PublicAppConfig = {
      allowOnlyCcOrOwn: config.allowOnlyCcOrOwn,
      turnstileEnabled: config.turnstileEnabled && Boolean(config.turnstileSiteKey),
      turnstileSiteKey: config.turnstileEnabled ? config.turnstileSiteKey || null : null,
      maxVideoDurationSec: config.maxVideoDurationSec,
      maxClipDurationSec: config.maxClipDurationSec,
      minClipDurationSec: config.minClipDurationSec,
      dmcaContactEmail: config.dmcaContactEmail,
    };
    res.json(publicConfig);
  });

  router.post('/video/info', infoLimiter, async (req: Request, res: Response) => {
    const bodyCheck = VideoInfoRequestSchema.safeParse(req.body);
    if (!bodyCheck.success) {
      res.status(400).json({
        error: bodyCheck.error.issues[0]?.message || 'Invalid request body.',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const parsedUrl = parseYouTubeUrl(bodyCheck.data.url);
    if (!parsedUrl.valid) {
      res.status(400).json({
        error: parsedUrl.reason,
        code: 'INVALID_YOUTUBE_URL',
      });
      return;
    }

    try {
      const cached = videoCache.get(parsedUrl.videoId);
      let info: VideoInfo;
      if (cached && cached.expiresAt > Date.now()) {
        info = {
          ...cached.info,
          initialTimestampSec: parsedUrl.initialTimestampSec,
        };
      } else {
        info = await fetchVideoInfo(parsedUrl.videoId, parsedUrl.initialTimestampSec);
        videoCache.set(parsedUrl.videoId, {
          info,
          expiresAt: Date.now() + 15 * 60 * 1000,
        });
      }
      res.json(info);
    } catch (err) {
      if (err instanceof VideoInfoError) {
        res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
          availability: err.availability,
        });
        return;
      }
      req.log.error({ err, videoId: parsedUrl.videoId }, 'Unhandled error in /api/video/info');
      res.status(500).json({
        error: 'Failed to inspect video metadata. Please try again.',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  router.post(
    '/clips',
    clipsLimiter,
    verifyTurnstileMiddleware,
    async (req: Request, res: Response) => {
      const parsed = CreateClipRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid clip parameters.',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      const { videoId, start, end, framing, cropX } = parsed.data;

      try {
        let videoInfo = videoCache.get(videoId)?.info;
        if (!videoInfo) {
          videoInfo = await fetchVideoInfo(videoId);
          videoCache.set(videoId, {
            info: videoInfo,
            expiresAt: Date.now() + 15 * 60 * 1000,
          });
        }

        // Strict server-side bounds verification
        if (end > videoInfo.duration + 0.05) {
          res.status(400).json({
            error: 'Selected end time exceeds the video duration.',
            code: 'BOUNDS_EXCEEDED',
          });
          return;
        }

        const clampedEnd = Math.min(end, videoInfo.duration);
        if (clampedEnd - start < config.minClipDurationSec) {
          res.status(400).json({
            error: `Clip duration must be at least ${config.minClipDurationSec} second.`,
            code: 'CLIP_TOO_SHORT',
          });
          return;
        }

        if (clampedEnd - start > config.maxClipDurationSec) {
          res.status(400).json({
            error: `Clip duration cannot exceed ${config.maxClipDurationSec} seconds.`,
            code: 'CLIP_TOO_LONG',
          });
          return;
        }

        const job = await queue.enqueue({
          videoInfo,
          startSec: start,
          endSec: clampedEnd,
          framing,
          cropX: framing === 'custom' ? (cropX ?? 0.5) : undefined,
        });

        res.status(202).json({
          jobId: job.jobId,
          status: job.status,
          queuePosition: job.queuePosition,
        });
      } catch (err) {
        if (err instanceof VideoInfoError) {
          res.status(err.statusCode).json({
            error: err.message,
            code: err.code,
          });
          return;
        }
        const statusCode =
          typeof (err as { statusCode?: unknown })?.statusCode === 'number'
            ? (err as { statusCode: number }).statusCode
            : 500;
        const code =
          typeof (err as { code?: unknown })?.code === 'string'
            ? (err as { code: string }).code
            : 'CLIP_ENQUEUE_FAILED';
        req.log.error({ err, videoId }, 'Failed to enqueue clip job');
        res.status(statusCode).json({
          error: err instanceof Error ? err.message : 'Unable to start clip job.',
          code,
        });
      }
    },
  );

  router.get('/clips/:jobId', (req: Request, res: Response) => {
    const idCheck = JobIdParamSchema.safeParse(req.params.jobId);
    if (!idCheck.success) {
      res.status(400).json({ error: 'Invalid clip job ID.', code: 'INVALID_JOB_ID' });
      return;
    }

    const job = queue.getJob(idCheck.data);
    if (!job) {
      res.status(404).json({
        error: 'This clip expired, please create it again.',
        code: 'CLIP_EXPIRED',
      });
      return;
    }

    res.json(queue.toProgressEvent(job));
  });

  router.get('/clips/:jobId/events', (req: Request, res: Response) => {
    const idCheck = JobIdParamSchema.safeParse(req.params.jobId);
    if (!idCheck.success) {
      res.status(400).json({ error: 'Invalid clip job ID.', code: 'INVALID_JOB_ID' });
      return;
    }

    const jobId = idCheck.data;
    const job = queue.getJob(jobId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    if (!job) {
      sendEvent({
        jobId,
        status: 'expired',
        progress: 0,
        error: 'This clip expired, please create it again.',
      });
      res.end();
      return;
    }

    sendEvent(queue.toProgressEvent(job));

    if (job.status === 'ready' || job.status === 'failed' || job.status === 'expired') {
      res.end();
      return;
    }

    const unsubscribe = queue.subscribe(jobId, (evt) => {
      sendEvent(evt);
      if (evt.status === 'ready' || evt.status === 'failed' || evt.status === 'expired') {
        cleanup();
        res.end();
      }
    });

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on('close', cleanup);
  });

  router.get('/clips/:jobId/download', async (req: Request, res: Response) => {
    const idCheck = JobIdParamSchema.safeParse(req.params.jobId);
    if (!idCheck.success) {
      res.status(400).json({ error: 'Invalid clip job ID.', code: 'INVALID_JOB_ID' });
      return;
    }

    const jobId = idCheck.data;
    const job = queue.getJob(jobId);

    if (!job || job.status === 'expired' || !job.outputPath) {
      res.status(410).json({
        error: 'This clip expired, please create it again.',
        code: 'CLIP_EXPIRED',
      });
      return;
    }

    if (job.status !== 'ready') {
      res.status(409).json({
        error: 'This clip is still processing.',
        code: 'CLIP_NOT_READY',
      });
      return;
    }

    try {
      const stat = await fsPromises.stat(job.outputPath);
      const isPreview = req.query.preview === '1';

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, no-store');

      if (isPreview) {
        res.setHeader('Content-Disposition', `inline; filename="${job.filename}"`);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
      }

      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
        if (!match) {
          res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
          return;
        }
        const start = Number.parseInt(match[1], 10);
        const end = match[2] ? Math.min(stat.size - 1, Number.parseInt(match[2], 10)) : stat.size - 1;
        if (start >= stat.size || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
          return;
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(job.outputPath, { start, end }).pipe(res);
      } else {
        res.setHeader('Content-Length', stat.size);
        const stream = fs.createReadStream(job.outputPath);
        stream.pipe(res);
        if (!isPreview) {
          res.on('finish', () => {
            // Delete temp files shortly after download completes (allows mobile retry/range finish)
            queue.schedulePostDownloadCleanup(jobId, 10000);
          });
        }
      }
    } catch {
      res.status(410).json({
        error: 'This clip expired, please create it again.',
        code: 'CLIP_EXPIRED',
      });
    }
  });

  router.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'API endpoint not found.',
      code: 'NOT_FOUND',
    });
  });

  return router;
}
