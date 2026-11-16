import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Redis } from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { config } from './config.ts';
import { logger } from './logger.ts';

function resolveFrameAncestors(): string[] {
  const defaults = [
    "'self'",
    'https://*.google.com',
    'https://localhost.corp.google.com:26001',
  ];
  const rawCsp = process.env.CSP_HEADER_VALUE?.trim();
  if (!rawCsp) return defaults;

  const match = rawCsp.match(/frame-ancestors\s+([^;]+)/i);
  if (!match) return defaults;

  const tokens = match[1]
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.length > 0 ? Array.from(new Set(["'self'", ...tokens])) : defaults;
}

export function buildHelmetMiddleware() {
  return helmet({
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://www.youtube.com',
          'https://s.ytimg.com',
          'https://challenges.cloudflare.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://i.ytimg.com',
          'https://*.ytimg.com',
        ],
        frameSrc: [
          "'self'",
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'https://challenges.cloudflare.com',
        ],
        frameAncestors: resolveFrameAncestors(),
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: [
          "'self'",
          ...(config.nodeEnv !== 'production' ? ['ws:', 'wss:'] : []),
          'https://www.youtube.com',
          'https://challenges.cloudflare.com',
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  });
}

export function buildCorsMiddleware() {
  const allowedOrigins = new Set<string>([
    config.appOrigin,
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
  ]);

  if (process.env.APP_URL) {
    allowedOrigins.add(process.env.APP_URL.trim());
  }

  return cors({
    origin(origin, callback) {
      // Allow same-origin requests with no Origin header (curl, SSR, health checks, native downloads)
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      // Allow Cloud Run hosted origins and localhost loopbacks across proxy ports
      if (
        origin.endsWith('.run.app') ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
}

function createStore(redisClient: Redis | null, prefix: string) {
  if (!redisClient) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redisClient.call(...(args as [string, ...string[]])) as Promise<number | string>,
  });
}

export function createInfoRateLimiter(redisClient: Redis | null) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: config.rateLimitInfoPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createStore(redisClient, 'rl:info:'),
    message: {
      error: 'Too many video lookups. Please wait a minute before trying again.',
      code: 'RATE_LIMIT_INFO',
    },
  });
}

export function createClipsRateLimiter(redisClient: Redis | null) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.rateLimitClipsPerHour,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createStore(redisClient, 'rl:clips:'),
    message: {
      error: 'Hourly clip limit reached. Please wait before creating another clip.',
      code: 'RATE_LIMIT_CLIPS',
    },
  });
}

export async function verifyTurnstileMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!config.turnstileEnabled || !config.turnstileSecretKey) {
    next();
    return;
  }

  const token =
    typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken.trim() : '';
  if (!token) {
    res.status(400).json({
      error: 'Please complete the verification challenge before creating a clip.',
      code: 'TURNSTILE_REQUIRED',
    });
    return;
  }

  try {
    const form = new URLSearchParams();
    form.set('secret', config.turnstileSecretKey);
    form.set('response', token);
    if (req.ip) form.set('remoteip', req.ip);

    const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = (await verifyResp.json()) as { success?: boolean };
    if (!data.success) {
      res.status(403).json({
        error: 'Bot verification failed. Please refresh and try again.',
        code: 'TURNSTILE_FAILED',
      });
      return;
    }
    next();
  } catch (err) {
    logger.error({ err }, 'Turnstile verification error');
    res.status(502).json({
      error: 'Could not verify challenge right now. Please try again.',
      code: 'TURNSTILE_ERROR',
    });
  }
}
