import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { logger } from './logger.ts';

export function ensureTempDirSync(): void {
  fsSync.mkdirSync(config.tempDir, { recursive: true });
}

export function getJobDir(jobId: string): string {
  // Strict UUID validation guard against path traversal
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error('Invalid job ID for storage path');
  }
  return path.join(config.tempDir, jobId);
}

export async function createJobDir(jobId: string): Promise<string> {
  ensureTempDirSync();
  const dir = getJobDir(jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function removeJobDir(jobId: string): Promise<void> {
  try {
    const dir = getJobDir(jobId);
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err, jobId }, 'Failed to remove temp job directory');
  }
}

export async function checkDiskSpace(): Promise<{ ok: boolean; freeMb: number }> {
  ensureTempDirSync();
  try {
    const stats = await fs.statfs(config.tempDir);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const freeMb = Math.floor(freeBytes / (1024 * 1024));
    return {
      ok: freeMb >= config.minFreeDiskMb,
      freeMb,
    };
  } catch (err) {
    logger.warn({ err }, 'statfs check failed, allowing job cautiously');
    return { ok: true, freeMb: config.minFreeDiskMb };
  }
}

export async function sweepExpiredTempDirs(activeJobIds: Set<string>): Promise<number> {
  ensureTempDirSync();
  let removed = 0;
  try {
    const entries = await fs.readdir(config.tempDir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      const fullPath = path.join(config.tempDir, entry.name);
      if (entry.name === 'bin' || activeJobIds.has(entry.name)) {
        continue;
      }
      try {
        const stat = await fs.stat(fullPath);
        if (now - stat.mtimeMs >= config.retentionMs) {
          await fs.rm(fullPath, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // Ignore race condition if already removed
      }
    }
    if (removed > 0) {
      logger.info({ removed }, 'Cleaned up expired temp clip directories');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed during temp directory cleanup sweep');
  }
  return removed;
}

export function startCleanupScheduler(getActiveJobIds: () => Set<string>): () => void {
  ensureTempDirSync();
  // Startup sweep removes any leftover files from prior container runs
  void sweepExpiredTempDirs(getActiveJobIds());

  const interval = setInterval(() => {
    void sweepExpiredTempDirs(getActiveJobIds());
  }, 10 * 60 * 1000);
  interval.unref();

  return () => clearInterval(interval);
}
