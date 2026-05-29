import { metaClient } from './client';
import { LEAD_ACTION_TYPES } from '../config/constants';
import { getDayInTz } from '../lib/date';
import { logger } from '../lib/logger';
import type { AdsetInsight, CampaignInsight } from './types';

/**
 * Campaign 1 — adset-level statistika (5 filial = 5 adset)
 */
export class InsightsService {
  /**
   * Adset-level insights.
   * @param daysAgo 0=bugun, 1=kecha (default)
   */
  async getAdsetStats(campaignId: string, daysAgo: number = 1): Promise<AdsetInsight[]> {
    const { isoDate } = getDayInTz(daysAgo);

    logger.info({ campaignId, date: isoDate, daysAgo }, '📥 Adset insights olinmoqda');

    const insights = await metaClient.getAllPages<AdsetInsight>(
      `/${campaignId}/insights`,
      {
        level: 'adset',
        time_range: JSON.stringify({ since: isoDate, until: isoDate }),
        time_increment: 1,
        fields: [
          'campaign_id',
          'campaign_name',
          'adset_id',
          'adset_name',
          'spend',
          'impressions',
          'reach',
          'frequency',
          'cpm',
          'ctr',
          'actions',
          'cost_per_action_type',
        ].join(','),
        action_breakdowns: 'action_type',
      }
    );

    logger.info(
      { campaignId, adsetCount: insights.length, date: isoDate },
      '✅ Adset insights olindi'
    );

    return insights;
  }

  /** Backward compat */
  async getYesterdayAdsetStats(campaignId: string): Promise<AdsetInsight[]> {
    return this.getAdsetStats(campaignId, 1);
  }

  /**
   * Campaign-level statistika
   */
  async getCampaignStats(campaignId: string, daysAgo: number = 1): Promise<CampaignInsight | null> {
    const { isoDate } = getDayInTz(daysAgo);

    const response = await metaClient.get<{ data: CampaignInsight[] }>(
      `/${campaignId}/insights`,
      {
        level: 'campaign',
        time_range: JSON.stringify({ since: isoDate, until: isoDate }),
        time_increment: 1,
        fields: [
          'campaign_id',
          'campaign_name',
          'spend',
          'impressions',
          'reach',
          'cpm',
          'ctr',
          'actions',
        ].join(','),
        action_breakdowns: 'action_type',
      }
    );

    return response.data?.[0] ?? null;
  }

  /** Backward compat */
  async getYesterdayCampaignStats(campaignId: string): Promise<CampaignInsight | null> {
    return this.getCampaignStats(campaignId, 1);
  }

  /**
   * Actions array dan lead miqdorini olish.
   * Bir necha lead action turi bo'lishi mumkin — biz unique deduplikatsiya qilamiz.
   */
  extractLeads(actions: AdsetInsight['actions'] | undefined): number {
    if (!actions || actions.length === 0) return 0;

    // Lead action turlarini topish
    const leadActions = actions.filter(a => LEAD_ACTION_TYPES.includes(a.action_type));
    if (leadActions.length === 0) return 0;

    // Eng katta qiymatni olamiz (action turlari overlap qilishi mumkin)
    return leadActions.reduce((max, a) => {
      const v = parseInt(a.value, 10);
      return isNaN(v) ? max : Math.max(max, v);
    }, 0);
  }

  extractLinkClicks(actions: AdsetInsight['actions'] | undefined): number {
    if (!actions) return 0;
    const click = actions.find(a => a.action_type === 'link_click');
    return click ? parseInt(click.value, 10) || 0 : 0;
  }
}

export const insightsService = new InsightsService();
