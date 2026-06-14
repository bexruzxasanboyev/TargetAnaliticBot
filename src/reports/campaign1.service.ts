import { Prisma, CampaignType, ReportStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { insightsService } from '../meta/insights.service';
import { ReportGenerationError } from '../lib/errors';
import { env } from '../config/env';
import { getDayInTz } from '../lib/date';
import { BRANCH_NORMALIZATION, canonicalizeName } from '../config/constants';

/**
 * Adset nomidan filial nomini ajratib olish.
 * Misol: "TOF - B - Tash [Mirobod 5KM] All - 13.05" → "Mirobod"
 *        "TOF - B - Tash [Qo'yliq 5KM] All" → "Qo'yliq"
 *        "Chilonzor" → "Chilonzor"
 */
function extractBranchName(adsetName: string): string {
  // 1. Kvadrat qavslar ichidan olish [<branch> ...]
  const bracketMatch = adsetName.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    let raw = bracketMatch[1];
    // "5KM", "10KM", radius'larni o'chirish
    raw = raw.replace(/\s*\d+\s*KM/gi, '').trim();
    if (raw) return normalizeBranch(raw);
  }

  // 2. BRANCH_NORMALIZATION dictionary'dan qidirish
  const canon = canonicalizeName(adsetName);
  for (const [key, value] of Object.entries(BRANCH_NORMALIZATION)) {
    if (canon.includes(key)) return value;
  }

  // 3. Aks holda asl nomni qaytarish
  return adsetName.trim();
}

function normalizeBranch(raw: string): string {
  const cleaned = canonicalizeName(raw).replace(/['`'']/g, '');
  for (const [key, value] of Object.entries(BRANCH_NORMALIZATION)) {
    if (cleaned.includes(key)) return value;
  }
  return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();
}

/**
 * Campaign 1 — har bir filial adset bo'yicha to'liq statistika.
 * Adset nomi = filial nomi deb hisoblaymiz.
 */
export class Campaign1Service {
  async generate(daysAgo: number = 1): Promise<string> {
    const { date: reportDate } = getDayInTz(daysAgo);
    const campaignId = env.META_CAMPAIGN_1_ID;

    const report = await prisma.dailyReport.upsert({
      where: {
        reportDate_campaignType: {
          reportDate,
          campaignType: CampaignType.CAMPAIGN_1,
        },
      },
      create: {
        reportDate,
        campaignType: CampaignType.CAMPAIGN_1,
        campaignId,
        status: ReportStatus.FETCHING,
      },
      update: {
        status: ReportStatus.FETCHING,
        errorMessage: null,
      },
    });

    try {
      const insights = await insightsService.getAdsetStats(campaignId, daysAgo);

      // Eski branch stats ni o'chirish (re-run safe)
      await prisma.branchStat.deleteMany({ where: { reportId: report.id } });

      let totalSpend = 0;
      let totalLeads = 0;
      let totalReach = 0;
      let totalImpressions = 0;
      let totalLinkClicks = 0;

      for (const ins of insights) {
        const leads = insightsService.extractLeads(ins.actions);
        const linkClicks = insightsService.extractLinkClicks(ins.actions);
        const spend = parseFloat(ins.spend || '0');
        const impressions = parseInt(ins.impressions || '0', 10);
        const reach = parseInt(ins.reach || '0', 10);
        const cpm = parseFloat(ins.cpm || '0');
        const ctr = parseFloat(ins.ctr || '0');
        const frequency = parseFloat(ins.frequency || '0');
        const cpl = leads > 0 ? spend / leads : 0;

        const cleanBranchName = extractBranchName(ins.adset_name);

        await prisma.branchStat.create({
          data: {
            reportId: report.id,
            branchName: cleanBranchName,
            adsetId: ins.adset_id,
            adsetName: ins.adset_name,
            spend: new Prisma.Decimal(spend.toFixed(2)),
            leads,
            cpl: new Prisma.Decimal(cpl.toFixed(2)),
            impressions,
            reach,
            cpm: new Prisma.Decimal(cpm.toFixed(4)),
            linkClicks,
            ctr: new Prisma.Decimal(ctr.toFixed(4)),
            frequency: new Prisma.Decimal(frequency.toFixed(4)),
            isAllocated: false,
          },
        });

        totalSpend += spend;
        totalLeads += leads;
        totalReach += reach;
        totalImpressions += impressions;
        totalLinkClicks += linkClicks;
      }

      await prisma.dailyReport.update({
        where: { id: report.id },
        data: {
          totalSpend: new Prisma.Decimal(totalSpend.toFixed(2)),
          totalLeads,
          totalReach,
          totalImpressions,
          totalLinkClicks,
          status: ReportStatus.COMPLETED,
        },
      });

      logger.info(
        { reportId: report.id, totalLeads, totalSpend, branches: insights.length },
        '✅ Campaign 1 hisoboti tayyor'
      );

      return report.id;
    } catch (error: any) {
      await prisma.dailyReport.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.FAILED,
          errorMessage: error.message?.slice(0, 1000),
        },
      });
      throw new ReportGenerationError(
        `Campaign 1 hisobotini yaratishda xato: ${error.message}`,
        error
      );
    }
  }
}

export const campaign1Service = new Campaign1Service();
