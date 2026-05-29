import axios, { AxiosInstance, AxiosError } from 'axios';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { withRetry } from '../lib/retry';
import { metaLimiter } from './rate-limiter';
import {
  MetaApiError,
  MetaTokenExpiredError,
  MetaRateLimitError,
} from '../lib/errors';
import { META_BASE_URL, META_ERROR_CODES } from '../config/constants';
import type { MetaPagedResponse, MetaErrorBody } from './types';
import { prisma } from '../lib/prisma';

export class MetaApiClient {
  private http: AxiosInstance;
  private accessToken: string;

  constructor(accessToken: string = env.META_ACCESS_TOKEN) {
    this.accessToken = accessToken;
    this.http = axios.create({
      baseURL: `${META_BASE_URL}/${env.META_API_VERSION}`,
      timeout: 30_000,
      headers: { 'Accept-Encoding': 'gzip,deflate' },
    });

    this.http.interceptors.request.use(config => {
      config.params = { ...(config.params || {}), access_token: this.accessToken };
      (config as any).metadata = { start: Date.now() };
      logger.debug({ url: config.url }, 'Meta API request');
      return config;
    });

    this.http.interceptors.response.use(
      async res => {
        const start = (res.config as any).metadata?.start;
        const duration = start ? Date.now() - start : 0;

        // X-Business-Use-Case-Usage header tekshirish
        const usage = res.headers['x-business-use-case-usage'];
        if (usage) this.checkBusinessUsage(String(usage));

        // Audit log
        await this.logApiCall({
          endpoint: res.config.url ?? 'unknown',
          method: (res.config.method ?? 'GET').toUpperCase(),
          statusCode: res.status,
          duration,
        }).catch(() => { /* ignore audit log errors */ });

        return res;
      },
      async (error: AxiosError<MetaErrorBody>) => {
        const start = (error.config as any)?.metadata?.start;
        const duration = start ? Date.now() - start : 0;

        const body = error.response?.data;
        const fbCode = body?.error?.code;
        const fbSubcode = body?.error?.error_subcode;

        await this.logApiCall({
          endpoint: error.config?.url ?? 'unknown',
          method: (error.config?.method ?? 'GET').toUpperCase(),
          statusCode: error.response?.status,
          duration,
          errorCode: fbCode,
          errorBody: JSON.stringify(body ?? error.message).slice(0, 4000),
        }).catch(() => {});

        throw this.mapError(error);
      }
    );
  }

  /**
   * Asosiy GET — rate limiter + retry bilan.
   */
  async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    return metaLimiter.schedule(() =>
      withRetry(async () => {
        const res = await this.http.get<T>(path, { params });
        return res.data;
      })
    );
  }

  /**
   * Cursor-based pagination — barcha sahifalarni o'qish.
   */
  async getAllPages<T>(
    path: string,
    params: Record<string, unknown>,
    pageSize = 100
  ): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = path;
    let nextParams: Record<string, unknown> | null = { ...params, limit: pageSize };

    while (nextUrl) {
      const response: MetaPagedResponse<T> = nextParams
        ? await this.get<MetaPagedResponse<T>>(nextUrl, nextParams)
        : await this.fetchAbsoluteUrl<MetaPagedResponse<T>>(nextUrl);

      if (response.data?.length) results.push(...response.data);

      const next: string | undefined = response.paging?.next;
      nextUrl = next ?? null;
      nextParams = null; // paging.next absolute URL bo'lib, o'z params ini olib keladi
    }

    return results;
  }

  /**
   * paging.next absolute URL — access_token bilan to'g'ridan-to'g'ri request.
   */
  private async fetchAbsoluteUrl<T>(url: string): Promise<T> {
    return metaLimiter.schedule(() =>
      withRetry(async () => {
        const res = await axios.get<T>(url, { timeout: 30_000 });
        return res.data;
      })
    );
  }

  /**
   * Business usage header parsing
   */
  private checkBusinessUsage(headerValue: string): void {
    try {
      const parsed = JSON.parse(headerValue) as Record<string, Array<Record<string, number>>>;
      for (const [accountId, usages] of Object.entries(parsed)) {
        const usage = usages?.[0];
        if (!usage) continue;
        const max = Math.max(
          usage.call_count ?? 0,
          usage.total_cputime ?? 0,
          usage.total_time ?? 0
        );
        if (max > 80) {
          logger.warn({ accountId, usage }, '⚠️ Meta API rate limit yaqin (>80%)');
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  /**
   * Meta API xatosini bizning error class lariga map qilish
   */
  private mapError(error: AxiosError<MetaErrorBody>): Error {
    const body = error.response?.data;
    const fbCode = body?.error?.code;
    const fbSubcode = body?.error?.error_subcode;
    const fbtraceId = body?.error?.fbtrace_id;
    const message = body?.error?.message ?? error.message;
    const status = error.response?.status;

    if (fbCode === META_ERROR_CODES.TOKEN_EXPIRED) {
      return new MetaTokenExpiredError(message);
    }

    if (
      fbCode === META_ERROR_CODES.RATE_LIMIT_APP ||
      fbCode === META_ERROR_CODES.RATE_LIMIT_USER ||
      fbCode === META_ERROR_CODES.TOO_MANY_CALLS ||
      fbCode === META_ERROR_CODES.AD_ACCOUNT_RATE_LIMIT ||
      status === 429
    ) {
      return new MetaRateLimitError(message);
    }

    return new MetaApiError(message, {
      metaErrorCode: fbCode,
      metaErrorSubcode: fbSubcode,
      fbtraceId,
      statusCode: status,
      cause: error,
    });
  }

  private async logApiCall(data: {
    endpoint: string;
    method: string;
    statusCode?: number;
    duration: number;
    errorCode?: number;
    errorBody?: string;
  }): Promise<void> {
    await prisma.apiCallLog.create({ data }).catch(() => {});
  }
}

export const metaClient = new MetaApiClient();
