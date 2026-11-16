import express from 'express';
import { startCleanupScheduler } from './cleanup.ts';
import { requestIdMiddleware } from './logger.ts';
import { buildCorsMiddleware, buildHelmetMiddleware } from './middleware.ts';
import { ClipQueueManager } from './queue.ts';
import { createApiRouter } from './routes.ts';
import { startYtDlpAutoUpdater } from './ytdlp.ts';

export async function createBackendApp() {
  const app = express();
  app.set('trust proxy', 1);

  const queue = new ClipQueueManager();
  await queue.init();

  const stopCleanup = startCleanupScheduler(() => queue.getActiveJobIds());
  const stopAutoUpdate = startYtDlpAutoUpdater();

  app.use(requestIdMiddleware);
  app.use(buildHelmetMiddleware());
  app.use(buildCorsMiddleware());
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', createApiRouter(queue));

  const shutdown = async () => {
    stopCleanup();
    stopAutoUpdate();
    await queue.close();
  };

  return { app, queue, shutdown };
}
