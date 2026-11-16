import pino from 'pino';
import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.ts';

export const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'turnstileToken',
      '*.turnstileSecretKey',
    ],
    censor: '[REDACTED]',
  },
  base: {
    service: 'clipshort-api',
  },
});

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: pino.Logger;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : uuidv4();
  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader('x-request-id', requestId);
  next();
}
