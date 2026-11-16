import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createBackendApp } from './apps/api/src/app.ts';
import { config, validateStartupConfig } from './apps/api/src/config.ts';
import { logger } from './apps/api/src/logger.ts';

function resolveDistDir(): string | null {
  const candidates = [
    path.resolve(import.meta.dirname, 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? null;
}

async function main() {
  validateStartupConfig(logger);

  const { app, queue, shutdown } = await createBackendApp();

  let activeDistDir: string | null = null;
  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    activeDistDir = resolveDistDir();
    if (!activeDistDir) {
      logger.error(
        {
          searchedDirs: [
            path.resolve(import.meta.dirname, 'dist'),
            path.resolve(process.cwd(), 'dist'),
          ],
        },
        'Production build directory (dist/index.html) not found. Run "npm run build" before starting in production.',
      );
      app.get('*', (_req, res) => {
        res.status(503).json({
          error: 'Frontend build artifacts are missing. Run npm run build before starting.',
          code: 'FRONTEND_NOT_BUILT',
        });
      });
    } else {
      app.use(
        express.static(activeDistDir, {
          index: false,
          maxAge: '1h',
          setHeaders(res, filePath) {
            if (filePath.endsWith('.html')) {
              res.setHeader('Cache-Control', 'no-cache');
            }
          },
        }),
      );
      app.get('*', (_req, res) => {
        res.sendFile(path.join(activeDistDir!, 'index.html'));
      });
    }
  }

  // Express error middleware so malformed JSON or unhandled route errors do not crash the server
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
    const message =
      status === 400 && err instanceof SyntaxError
        ? 'Invalid JSON request payload.'
        : 'Unexpected server error.';
    if (status >= 500) {
      req.log?.error({ err }, 'Unhandled HTTP request error');
    }
    res.status(status).json({
      error: message,
      code: status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR',
    });
  });

  const host = '0.0.0.0';
  const server = app.listen(config.port, host);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });

  server.on('error', (err) => {
    logger.fatal({ err, host, port: config.port }, 'HTTP server runtime error');
    process.exit(1);
  });

  // SSE-friendly timeouts (no premature 2-minute drop on slow renders)
  server.requestTimeout = 0;
  server.headersTimeout = 65000;

  logger.info(
    {
      host,
      port: config.port,
      env: config.nodeEnv,
      queueMode: queue.isUsingRedis() ? 'redis' : 'memory',
      staticDir: activeDistDir ?? 'vite-dev-middleware',
    },
    `ClipShort server listening on http://${host}:${config.port}`,
  );

  let isShuttingDown = false;
  const handleSignal = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutting down server gracefully');
    await shutdown();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void handleSignal('SIGINT'));
  process.on('SIGTERM', () => void handleSignal('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err, port: config.port, env: config.nodeEnv }, 'Failed to start ClipShort server');
  process.exit(1);
});
