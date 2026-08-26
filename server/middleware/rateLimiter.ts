import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * In-Memory Sliding Window Rate Limiter.
 * Tracks request limits by authenticated User ID (or IP address if unauthenticated).
 */
export function createRateLimiter(options: {
  windowMs: number; // Time window in milliseconds (e.g., 60,000 for 1 min)
  maxRequests: number; // Max allowed requests in this window
  message: string;
  keyPrefix?: string;
}) {
  const store = new Map<string, RateLimitRecord>();

  // Periodically clean expired entries every 2 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }, 120_000);

  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    const identifier = authReq.user?.id || req.ip || req.socket.remoteAddress || 'anonymous';
    const key = `${options.keyPrefix || 'rl'}:${identifier}`;
    const now = Date.now();

    let record = store.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + options.windowMs,
      };
      store.set(key, record);
      res.setHeader('X-RateLimit-Limit', options.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, options.maxRequests - 1));
      res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
      next();
      return;
    }

    record.count++;
    res.setHeader('X-RateLimit-Limit', options.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > options.maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        success: false,
        error: options.message,
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

// 1. Rate limiter for expensive OCR processing (10 requests / min per user/IP)
export const ocrRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Bạn đã gửi quá nhiều yêu cầu xử lý OCR trong thời gian ngắn. Vui lòng thử lại sau 1 phút.',
  keyPrefix: 'ocr',
});

// 2. Rate limiter for Excel Export generation (15 requests / min per user/IP)
export const exportRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 15,
  message: 'Bạn đã gửi quá nhiều yêu cầu xuất tệp Excel. Vui lòng đợi trong giây lát.',
  keyPrefix: 'export',
});

// 3. General API rate limiter (120 requests / min)
export const generalApiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: 'Quá nhiều yêu cầu gửi tới hệ thống. Vui lòng thử lại sau ít phút.',
  keyPrefix: 'api',
});
