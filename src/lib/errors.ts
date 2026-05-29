/**
 * Loyiha bo'yicha custom error class lari
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly cause?: unknown;

  constructor(message: string, code = 'APP_ERROR', statusCode?: number, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class MetaApiError extends AppError {
  public readonly metaErrorCode?: number;
  public readonly metaErrorSubcode?: number;
  public readonly fbtraceId?: string;

  constructor(
    message: string,
    options: {
      metaErrorCode?: number;
      metaErrorSubcode?: number;
      fbtraceId?: string;
      statusCode?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message, 'META_API_ERROR', options.statusCode, options.cause);
    this.metaErrorCode = options.metaErrorCode;
    this.metaErrorSubcode = options.metaErrorSubcode;
    this.fbtraceId = options.fbtraceId;
  }
}

export class MetaTokenExpiredError extends MetaApiError {
  constructor(message = 'Meta access token muddati tugagan yoki invalid') {
    super(message, { metaErrorCode: 190, statusCode: 401 });
    this.name = 'MetaTokenExpiredError';
  }
}

export class MetaRateLimitError extends MetaApiError {
  constructor(message = 'Meta API rate limit ga yetildi') {
    super(message, { statusCode: 429 });
    this.name = 'MetaRateLimitError';
  }
}

export class TelegramSendError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'TELEGRAM_SEND_ERROR', undefined, cause);
  }
}

export class ReportGenerationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'REPORT_GENERATION_ERROR', undefined, cause);
  }
}
