import { Prisma, CampaignType, ReportStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { leadsService } from '../meta/leads.service';
import { insightsService } from '../meta/insights.service';
import { aggregator } from './aggregator';
import { ReportGenerationError } from '../lib/errors';
import { env } from '../config/env';
import { getDayInTz } from '../lib/date';

/**
 * Campaign 2 — lead form bilan ishlaydi.
 * Leadlar field_data ichidagi "filial" javobi bo'yicha guruhlanadi.
 * Spend leadlar soniga proporsional taqsimlanadi.
 */
export class Campaign2Service {
  async generate(daysAgo: number = 1): Promise<string> {
    const { date: reportDate } = getDayInTz(daysAgo);
    const campaignId = env.META_CAMPAIGN_2_ID;

    const report = await prisma.dailyReport.upsert({
      where: {
        reportDate_campaignType: {
          reportDate,
          campaignType: CampaignType.CAMPAIGN_2,
        },
      },
      create: {
        reportDate,
        campaignType: CampaignType.CAMPAIGN_2,
        campaignId,
        status: ReportStatus.FETCHING,
      },
      update: {
        status: ReportStatus.FETCHING,
        errorMessage: null,
      },
    });

    try {
      // 1. Parallel: leadlar + campaign-level insights
      const [leads, campaignStats] = await Promise.all([
        leadsService.getLeads(campaignId, daysAgo),
        insightsService.getCampaignStats(campaignId, daysAgo),
      ]);

      const totalSpend = parseFloat(campaignStats?.spend ?? '0');
      const totalImpressions = parseInt(campaignStats?.impressions ?? '0', 10);
      const totalReach = parseInt(campaignStats?.reach ?? '0', 10);

      // 2. Raw leadlarni saqlash (audit, future re-analysis uchun)
      for (const lead of leads) {
        await prisma.leadFormResponse.upsert({
          where: { leadId: lead.leadId },
          create: {
            leadId: lead.leadId,
            campaignId,
            adsetId: lead.adsetId ?? undefined,
            formId: lead.formId,
            branchName: lead.branchName,
            rawFieldData: lead.rawFields,
            createdTime: lead.createdTime,
          },
          update: {
            branchName: lead.branchName,
            rawFieldData: lead.rawFields,
          },
        });
      }

      // 3. Filial bo'yicha proporsional taqsimlash
      const aggregated = aggregator.allocateSpendByLeads(leads, totalSpend);

      await prisma.branchStat.deleteMany({ where: { reportId: report.id } });

      for (const a of aggregated) {
        await prisma.branchStat.create({
          data: {
            reportId: report.id,
            branchName: a.branchName,
            spend: new Prisma.Decimal(a.spend.toFixed(2)),
            leads: a.leads,
            cpl: new Prisma.Decimal(a.cpl.toFixed(2)),
            impressions: 0,
            reach: 0,
            cpm: new Prisma.Decimal(0),
            linkClicks: 0,
            ctr: new Prisma.Decimal(0),
            frequency: new Prisma.Decimal(0),
            isAllocated: true,
            allocationRatio: new Prisma.Decimal(a.allocationRatio.toFixed(8)),
          },
        });
      }

      await prisma.dailyReport.update({
        where: { id: report.id },
        data: {
          totalSpend: new Prisma.Decimal(totalSpend.toFixed(2)),
          totalLeads: leads.length,
          totalReach,
          totalImpressions,
          status: ReportStatus.COMPLETED,
        },
      });

      logger.info(
        {
          reportId: report.id,
          leads: leads.length,
          totalSpend,
          branches: aggregated.length,
        },
        '✅ Campaign 2 hisoboti tayyor'
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
        `Campaign 2 hisobotini yaratishda xato: ${error.message}`,
        error
      );
    }
  }
}

export const campaign2Service = new Campaign2Service();
