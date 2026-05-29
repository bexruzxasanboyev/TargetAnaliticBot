import { metaClient } from './client';
import { getDayInTz } from '../lib/date';
import { logger } from '../lib/logger';
import { BRANCH_FIELD_KEYWORDS, BRANCH_NORMALIZATION } from '../config/constants';
import type { RawLead, ParsedLead } from './types';

/**
 * Campaign 2 — lead form javoblarini olish va filial bo'yicha guruhlash
 */
export class LeadsService {
  /**
   * Tushgan leadlarni olish.
   * Meta'da `/campaign_id/leads` endpoint yo'q — shuning uchun:
   *   1. Campaign ostidagi barcha ad'larni olamiz
   *   2. Har bir ad uchun `/ad_id/leads` so'roviga yuboramiz
   *   3. Deduplicate qilamiz
   * @param daysAgo 0=bugun, 1=kecha (default)
   */
  async getLeads(campaignId: string, daysAgo: number = 1): Promise<ParsedLead[]> {
    const { sinceUnix, untilUnix, isoDate } = getDayInTz(daysAgo);

    logger.info(
      { campaignId, date: isoDate, daysAgo, sinceUnix, untilUnix },
      '📥 Leadlar olinmoqda'
    );

    // 1. Campaign ostidagi barcha ad ID larini olish
    const ads = await metaClient.getAllPages<{ id: string }>(
      `/${campaignId}/ads`,
      { fields: 'id' }
    );

    logger.info({ campaignId, adCount: ads.length }, 'Campaign ostidagi adlar topildi');

    // 2. Har bir ad dan leadlarni olish (parallel emas — rate limit'ga ehtiyot)
    const dedup = new Map<string, RawLead>();
    const filtering = JSON.stringify([
      { field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix },
      { field: 'time_created', operator: 'LESS_THAN', value: untilUnix },
    ]);
    const fields = 'id,created_time,ad_id,adset_id,campaign_id,form_id,field_data';

    for (const ad of ads) {
      try {
        const leads = await metaClient.getAllPages<RawLead>(
          `/${ad.id}/leads`,
          { fields, filtering }
        );
        for (const lead of leads) dedup.set(lead.id, lead);
      } catch (err) {
        logger.warn({ adId: ad.id, err: (err as Error).message }, 'Ad uchun leadlar olinmadi');
      }
    }

    const rawLeads = Array.from(dedup.values());
    const parsed = rawLeads.map(l => this.parseLead(l));
    logger.info(
      { campaignId, total: parsed.length, withBranch: parsed.filter(l => l.branchName).length },
      '✅ Leadlar olindi va parsing qilindi'
    );

    return parsed;
  }

  /** Backward compat */
  async getYesterdayLeads(campaignId: string): Promise<ParsedLead[]> {
    return this.getLeads(campaignId, 1);
  }

  /**
   * Raw lead → ParsedLead
   */
  private parseLead(raw: RawLead): ParsedLead {
    const fields: Record<string, string> = {};
    for (const f of raw.field_data) {
      fields[f.name.toLowerCase().trim()] = (f.values?.[0] ?? '').trim();
    }

    const branchName = this.detectBranch(fields);

    return {
      leadId: raw.id,
      createdTime: new Date(raw.created_time),
      adsetId: raw.adset_id ?? null,
      formId: raw.form_id,
      branchName,
      rawFields: fields,
    };
  }

  /**
   * Field data ichidan filial nomini topish va normalizatsiya qilish.
   */
  private detectBranch(fields: Record<string, string>): string | null {
    // 1. Kalit so'zli field nomi bo'yicha qidirish
    for (const key of Object.keys(fields)) {
      const isBranchField = BRANCH_FIELD_KEYWORDS.some(kw =>
        key.includes(kw.toLowerCase())
      );
      if (isBranchField && fields[key]) {
        return this.normalizeBranchName(fields[key]);
      }
    }

    // 2. Custom disclaimer/custom_disclaimer/select bo'yicha qidirish (Meta lead form ichida)
    for (const key of Object.keys(fields)) {
      if (key.includes('custom') || key.includes('select')) {
        const normalized = this.normalizeBranchName(fields[key]);
        if (normalized && normalized !== fields[key]) return normalized;
      }
    }

    return null;
  }

  private normalizeBranchName(raw: string): string {
    const cleaned = raw.toLowerCase().trim().replace(/[''`]/g, '');
    for (const [key, value] of Object.entries(BRANCH_NORMALIZATION)) {
      if (cleaned.includes(key)) return value;
    }
    // Dictionary da yo'q bo'lsa — birinchi harfini capitalize qilamiz
    if (!raw) return '';
    return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();
  }
}

export const leadsService = new LeadsService();
