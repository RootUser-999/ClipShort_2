import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import {
  buildClipFilename,
  type ClipJobStatus,
  type ClipProgressEvent,
  type FramingMode,
  type VideoInfo,
} from '../../../packages/shared/src/index.ts';
import { checkDiskSpace, createJobDir, removeJobDir } from './cleanup.ts';
import { config } from './config.ts';
import { renderVerticalClip } from './ffmpeg.ts';
import { logger } from './logger.ts';
import { downloadVideoSection } from './ytdlp.ts';

export interface EnqueueClipInput {
  videoInfo: VideoInfo;
  startSec: number;
  endSec: number;
  framing: FramingMode;
  cropX?: number;
}

export interface ClipJobRecord {
  jobId: string;
  dedupeKey: string;
  videoId: string;
  videoTitle: string;
  durationSec: number;
  startSec: number;
  endSec: number;
  framing: FramingMode;
  cropX?: number;
  status: ClipJobStatus;
  progress: number;
  queuePosition?: number;
  error?: string;
  outputPath?: string;
  filename: string;
  fileSizeBytes?: number;
  renderDurationMs?: number;
  createdAt: number;
  expiresAt?: number;
  expiryTimer?: NodeJS.Timeout;
  downloadCleanupTimer?: NodeJS.Timeout;
}

interface BullPayload {
  jobId: string;
  videoInfo: VideoInfo;
  startSec: number;
  endSec: number;
  framing: FramingMode;
  cropX?: number;
}

export class ClipQueueManager {
  private readonly jobs = new Map<string, ClipJobRecord>();
  private readonly activeDedupeMap = new Map<string, string>();
  private readonly pendingQueue: string[] = [];
  private activeCount = 0;
  private readonly emitter = new EventEmitter();

  private redisClient: Redis | null = null;
  private bullQueue: Queue<BullPayload> | null = null;
  private bullWorker: Worker<BullPayload> | null = null;
  private usingBullMq = false;

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  public getRedisClient(): Redis | null {
    return this.redisClient;
  }

  public isUsingRedis(): boolean {
    return this.usingBullMq;
  }

  public getActiveJobIds(): Set<string> {
    const active = new Set<string>();
    for (const [jobId, rec] of this.jobs.entries()) {
      if (rec.status !== 'expired' && rec.status !== 'failed') {
        active.add(jobId);
      }
    }
    return active;
  }

  public async init(): Promise<void> {
    if (!config.redisUrl) {
      logger.info({ concurrency: config.concurrency }, 'Using in-memory clip job queue (no REDIS_URL configured)');
      return;
    }

    let client: Redis | null = null;
    let connected = false;
    try {
      client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 2000,
        retryStrategy: () => null,
      });

      client.on('error', (err) => {
        if (connected) {
          logger.info({ reason: err.message }, 'Redis connection notice');
        }
      });

      await client.connect();
      await client.ping();
      connected = true;
      this.redisClient = client;

      this.bullQueue = new Queue<BullPayload>('clipshort-render', {
        connection: client.duplicate({ maxRetriesPerRequest: null }),
      });

      this.bullWorker = new Worker<BullPayload>(
        'clipshort-render',
        async (job: Job<BullPayload>) => {
          await this.executeClipJob(job.data.jobId, job.data.videoInfo);
        },
        {
          connection: client.duplicate({ maxRetriesPerRequest: null }),
          concurrency: config.concurrency,
        },
      );

      this.bullWorker.on('failed', (job, err) => {
        if (job) {
          logger.error({ jobId: job.data.jobId, err }, 'BullMQ worker job failed');
        }
      });

      this.usingBullMq = true;
      logger.info({ concurrency: config.concurrency }, 'Connected to Redis and initialized BullMQ worker');
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unreachable';
      logger.info({ reason, concurrency: config.concurrency }, 'Redis unavailable; falling back to in-memory job queue');
      if (client) {
        try {
          client.disconnect();
        } catch {
          // ignore
        }
      }
      this.redisClient = null;
      this.usingBullMq = false;
    }
  }

  public async close(): Promise<void> {
    for (const rec of this.jobs.values()) {
      if (rec.expiryTimer) clearTimeout(rec.expiryTimer);
      if (rec.downloadCleanupTimer) clearTimeout(rec.downloadCleanupTimer);
    }
    if (this.bullWorker) await this.bullWorker.close();
    if (this.bullQueue) await this.bullQueue.close();
    if (this.redisClient) this.redisClient.disconnect();
  }

  private buildDedupeKey(input: EnqueueClipInput): string {
    const s = Math.round(input.startSec * 1000);
    const e = Math.round(input.endSec * 1000);
    const cx = input.framing === 'custom' ? Math.round((input.cropX ?? 0.5) * 1000) : 500;
    return `${input.videoInfo.videoId}:${s}:${e}:${input.framing}:${cx}`;
  }

  public async enqueue(input: EnqueueClipInput): Promise<ClipJobRecord> {
    const dedupeKey = this.buildDedupeKey(input);
    const existingJobId = this.activeDedupeMap.get(dedupeKey);
    if (existingJobId) {
      const existing = this.jobs.get(existingJobId);
      if (
        existing &&
        (existing.status === 'queued' ||
          existing.status === 'downloading' ||
          existing.status === 'rendering')
      ) {
        return existing;
      }
    }

    const disk = await checkDiskSpace();
    if (!disk.ok) {
      throw Object.assign(
        new Error(`Server temporary storage is nearly full (${disk.freeMb} MB free). Please try again shortly.`),
        { code: 'LOW_DISK_SPACE', statusCode: 507 },
      );
    }

    const jobId = uuidv4();
    const filename = buildClipFilename(input.videoInfo.title, input.startSec, input.endSec);

    const record: ClipJobRecord = {
      jobId,
      dedupeKey,
      videoId: input.videoInfo.videoId,
      videoTitle: input.videoInfo.title,
      durationSec: input.endSec - input.startSec,
      startSec: input.startSec,
      endSec: input.endSec,
      framing: input.framing,
      cropX: input.cropX,
      status: 'queued',
      progress: 0,
      queuePosition: this.usingBullMq ? 1 : this.pendingQueue.length + (this.activeCount >= config.concurrency ? 1 : 0),
      filename,
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, record);
    this.activeDedupeMap.set(dedupeKey, jobId);

    if (this.usingBullMq && this.bullQueue) {
      await this.bullQueue.add(
        'render',
        {
          jobId,
          videoInfo: input.videoInfo,
          startSec: input.startSec,
          endSec: input.endSec,
          framing: input.framing,
          cropX: input.cropX,
        },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.emitProgress(record);
    } else {
      this.pendingQueue.push(jobId);
      this.updateQueuePositions();
      this.emitProgress(record);
      void this.pumpMemoryQueue(input.videoInfo);
    }

    return record;
  }

  private readonly videoInfoByJob = new Map<string, VideoInfo>();

  private async pumpMemoryQueue(latestVideoInfo?: VideoInfo): Promise<void> {
    if (latestVideoInfo) {
      for (const id of this.pendingQueue) {
        const rec = this.jobs.get(id);
        if (rec && rec.videoId === latestVideoInfo.videoId && !this.videoInfoByJob.has(id)) {
          this.videoInfoByJob.set(id, latestVideoInfo);
        }
      }
    }

    while (this.activeCount < config.concurrency && this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue.shift();
      if (!nextId) break;

      this.activeCount++;
      this.updateQueuePositions();

      const videoInfo = this.videoInfoByJob.get(nextId);
      this.videoInfoByJob.delete(nextId);

      void this.executeClipJob(nextId, videoInfo).finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.updateQueuePositions();
        void this.pumpMemoryQueue();
      });
    }
  }

  private updateQueuePositions(): void {
    this.pendingQueue.forEach((id, index) => {
      const rec = this.jobs.get(id);
      if (rec && rec.status === 'queued') {
        rec.queuePosition = index + 1;
        this.emitProgress(rec);
      }
    });
  }

  private async executeClipJob(jobId: string, videoInfo?: VideoInfo): Promise<void> {
    const rec = this.jobs.get(jobId);
    if (!rec) return;

    const startedAt = Date.now();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, config.jobTimeoutMs);

    try {
      const jobDir = await createJobDir(jobId);

      // Stage 1: Downloading section (0% -> 45% overall progress)
      rec.status = 'downloading';
      rec.queuePosition = 0;
      rec.progress = 2;
      this.emitProgress(rec);

      const downloadRes = await downloadVideoSection({
        videoId: rec.videoId,
        startSec: rec.startSec,
        endSec: rec.endSec,
        durationSec: videoInfo?.duration,
        jobDir,
        signal: abortController.signal,
        onProgress: (dlPct) => {
          const scaled = Math.min(45, Math.max(2, Math.round(2 + dlPct * 0.43)));
          if (scaled > rec.progress) {
            rec.progress = scaled;
            this.emitProgress(rec);
          }
        },
      });

      // Stage 2: Rendering vertical 9:16 clip (45% -> 99% overall progress)
      rec.status = 'rendering';
      rec.progress = Math.max(rec.progress, 46);
      this.emitProgress(rec);

      const outputPath = path.join(jobDir, 'output.mp4');
      await renderVerticalClip({
        inputPath: downloadRes.filePath,
        outputPath,
        trimOffsetSec: downloadRes.trimOffsetSec,
        clipDurationSec: rec.endSec - rec.startSec,
        framing: rec.framing,
        cropX: rec.cropX,
        signal: abortController.signal,
        onProgress: (renderPct) => {
          const scaled = Math.min(99, Math.max(46, Math.round(46 + renderPct * 0.53)));
          if (scaled > rec.progress) {
            rec.progress = scaled;
            this.emitProgress(rec);
          }
        },
      });

      // Remove intermediate downloaded file immediately to reclaim temp space
      await fs.rm(downloadRes.filePath, { force: true }).catch(() => {});

      const stat = await fs.stat(outputPath);
      const now = Date.now();

      rec.status = 'ready';
      rec.progress = 100;
      rec.outputPath = outputPath;
      rec.fileSizeBytes = stat.size;
      rec.renderDurationMs = now - startedAt;
      rec.expiresAt = now + config.retentionMs;

      this.scheduleJobExpiry(rec);
      this.emitProgress(rec);
      logger.info(
        {
          jobId,
          videoId: rec.videoId,
          framing: rec.framing,
          fileSizeBytes: stat.size,
          renderDurationMs: rec.renderDurationMs,
        },
        'Clip rendered successfully',
      );
    } catch (err) {
      const message =
        abortController.signal.aborted
          ? 'Clip creation timed out after 5 minutes. Try a shorter range or retry.'
          : err instanceof Error
            ? err.message
            : 'Unexpected error while creating clip.';

      rec.status = 'failed';
      rec.error = message;
      this.emitProgress(rec);
      await removeJobDir(jobId);
      logger.error({ jobId, videoId: rec.videoId, err }, 'Clip job failed');
    } finally {
      clearTimeout(timeoutHandle);
      this.activeDedupeMap.delete(rec.dedupeKey);
    }
  }

  private scheduleJobExpiry(rec: ClipJobRecord): void {
    if (rec.expiryTimer) clearTimeout(rec.expiryTimer);
    rec.expiryTimer = setTimeout(() => {
      void this.expireJob(rec.jobId);
    }, config.retentionMs);
    rec.expiryTimer.unref();
  }

  public schedulePostDownloadCleanup(jobId: string, delayMs = 10000): void {
    const rec = this.jobs.get(jobId);
    if (!rec || rec.downloadCleanupTimer) return;
    rec.downloadCleanupTimer = setTimeout(() => {
      void this.expireJob(jobId);
    }, delayMs);
    rec.downloadCleanupTimer.unref();
  }

  public async expireJob(jobId: string): Promise<void> {
    const rec = this.jobs.get(jobId);
    if (!rec) return;
    if (rec.expiryTimer) clearTimeout(rec.expiryTimer);
    if (rec.downloadCleanupTimer) clearTimeout(rec.downloadCleanupTimer);
    rec.status = 'expired';
    rec.outputPath = undefined;
    await removeJobDir(jobId);
    this.emitProgress(rec);
  }

  public getJob(jobId: string): ClipJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  public toProgressEvent(rec: ClipJobRecord): ClipProgressEvent {
    return {
      jobId: rec.jobId,
      status: rec.status,
      progress: rec.progress,
      queuePosition: rec.queuePosition,
      error: rec.error,
      filename: rec.filename,
      fileSizeBytes: rec.fileSizeBytes,
      renderDurationMs: rec.renderDurationMs,
      durationSec: rec.durationSec,
      videoTitle: rec.videoTitle,
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
    };
  }

  private emitProgress(rec: ClipJobRecord): void {
    this.emitter.emit(rec.jobId, this.toProgressEvent(rec));
  }

  public subscribe(jobId: string, listener: (event: ClipProgressEvent) => void): () => void {
    this.emitter.on(jobId, listener);
    return () => {
      this.emitter.off(jobId, listener);
    };
  }
}
