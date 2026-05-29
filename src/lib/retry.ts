import { logger } from './logger';
import { META_ERROR_CODES, RETRYABLE_HTTP_CODES } from '../config/constants';

export interface RetryOpts {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delay: number) => void;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {}
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelay = 1000,
    maxDelay = 60_000,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = opts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }

      const delay = Math.min(
        baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500),
        maxDelay
      );

      onRetry?.(err, attempt, delay);
      logger.warn(
        { attempt, maxAttempts, delay, err: errToObj(err) },
        'Retry boshlanmoqda'
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function defaultShouldRetry(err: unknown): boolean {
  const e = err as any;

  // Meta API specific
  const metaCode = e?.metaErrorCode ?? e?.code;
  if (
    metaCode === META_ERROR_CODES.RATE_LIMIT_APP ||
    metaCode === META_ERROR_CODES.RATE_LIMIT_USER ||
    metaCode === META_ERROR_CODES.TEMPORARY ||
    metaCode === META_ERROR_CODES.TOO_MANY_CALLS ||
    metaCode === META_ERROR_CODES.AD_ACCOUNT_RATE_LIMIT
  ) {
    return true;
  }

  // Token expired — retry qilmaymiz
  if (metaCode === META_ERROR_CODES.TOKEN_EXPIRED) return false;

  // HTTP status
  const status = e?.statusCode ?? e?.response?.status;
  if (typeof status === 'number' && RETRYABLE_HTTP_CODES.includes(status)) return true;

  // Network errors (Axios)
  const nodeCode = e?.code;
  if (typeof nodeCode === 'string') {
    if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'EAI_AGAIN'].includes(nodeCode)) {
      return true;
    }
  }

  return false;
}

function errToObj(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: (err as any).code,
      statusCode: (err as any).statusCode,
    };
  }
  return { value: String(err) };
}
