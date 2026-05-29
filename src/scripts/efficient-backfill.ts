/**
 * Optimallashtirilgan 30-kunlik backfill:
 *
 * Standart backfill (eski versiya) — har kun uchun alohida API call:
 *   30 kun × 2 campaign × ~30 ad = ~1800 API calls → rate limit!
 *
 * Bu yangi versiya — bir necha API call'ga sig'diradi:
 *   Campaign 1: 1 ta insights call (30 kun, time_increment=daily)
 *   Campaign 2: 1 ta insights call + N ad uchun 1 marta leads (30 kun range)
 *   Jami: ~10-30 call (rate limit'ga hech qachon yetmaydi)
 *
 * Foydalanish:
 *   npm run backfill:fast [kunlar]
 */
import { metaClient } from '../meta/client';
import { insightsService } from '../meta/insights.service';
import { leadsService } from '../meta/leads.service';
import { aggregator } from '../reports/aggregator';
import { sheetsService } from '../google/sheets.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getDayInTz } from '../lib/date';
import { env } from '../config/env';
import { CampaignType, Prisma, ReportStatus } from '@prisma/client';
import { format, subDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { AdsetInsight, CampaignInsight, RawLead, ParsedLead } from '../meta/types';

const BRANCH_FIELD_KEYWORDS = ['filial', 'branch', 'manzil', 'address', 'location'];

export async function runFastBackfill(days: number = 30): Promise<{
  total: number;
  campaign1Days: number;
  campaign2Days: number;
  errors: string[];
}> {
  logger.info({ days }, `🚀 Tezkor backfill boshlandi: oxirgi ${days} kun`);

  // 30 kunlik sana oralig'i (Asia/Tashkent)
  const nowLocal = toZonedTime(new Date(), env.TZ);
  const yesterdayLocal = subDays(nowLocal, 1);
  const startLocal = subDays(nowLocal, days);

  const sinceDate = format(startLocal, 'yyyy-MM-dd');
  const untilDate = format(yesterdayLocal, 'yyyy-MM-dd');

  logger.info({ sinceDate, untilDate }, 'Sana oralig\'i');

  const errors: string[] = [];

  // ========== CAMPAIGN 1: bitta insights call 30 kun uchun ==========
  let campaign1Days = 0;
  try {
    const insights = await metaClient.getAllPages<AdsetInsight & { date_start: string; date_stop: string }>(
      `/${env.META_CAMPAIGN_1_ID}/insights`,
      {
        level: 'adset',
        time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
        time_increment: 1,
        fields: 'adset_id,adset_name,spend,impressions,reach,frequency,cpm,ctr,actions,date_start,date_stop',
        action_breakdowns: 'action_type',
      }
    );

    logger.info({ totalRows: insights.length }, '📊 Campaign 1: 30 kunlik insights olindi');

    // Sana bo'yicha group
    const byDate = new Map<string, typeof insights>();
    for (const row of insights) {
      const date = row.date_start;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(row);
    }

    // Har kun uchun DB + Sheets
    for (const [dateStr, rows] of byDate.entries()) {
      try {
        await processCampaign1Day(dateStr, rows);
        campaign1Days++;
      } catch (err: any) {
        logger.error({ dateStr, err: err.message }, 'Campaign 1 kun ishlash xatosi');
        errors.push(`C1 ${dateStr}: ${err.message}`);
      }
    }

    logger.info({ campaign1Days }, '✅ Campaign 1 backfill tugadi');
  } catch (err: any) {
    logger.error({ err: err.message }, '❌ Campaign 1 backfill yiqildi');
    errors.push(`Campaign 1: ${err.message}`);
  }

  // ========== CAMPAIGN 2: leadlar + insights ==========
  let campaign2Days = 0;
  try {
    // 1. Campaign-level daily spend
    const c2Insights = await metaClient.getAllPages<CampaignInsight & { date_start: string }>(
      `/${env.META_CAMPAIGN_2_ID}/insights`,
      {
        level: 'campaign',
        time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
        time_increment: 1,
        fields: 'spend,impressions,reach,cpm,ctr,actions,date_start',
        action_breakdowns: 'action_type',
      }
    );
    logger.info({ days: c2Insights.length }, '📊 Campaign 2: kunlik spend olindi');

    // 2. Campaign 2 ostidagi barcha adlar
    const ads = await metaClient.getAllPages<{ id: string }>(
      `/${env.META_CAMPAIGN_2_ID}/ads`,
      { fields: 'id' }
    );
    logger.info({ adsCount: ads.length }, '📊 Campaign 2 adlari');

    // 3. Har bir ad uchun 30-kunlik leadlar (1 call per ad)
    const sinceUnix = Math.floor(fromZonedTime(new Date(`${sinceDate}T00:00:00`), env.TZ).getTime() / 1000);
    const untilUnix = Math.floor(fromZonedTime(new Date(`${untilDate}T23:59:59`), env.TZ).getTime() / 1000);

    const allLeads: ParsedLead[] = [];
    for (const ad of ads) {
      try {
        const adLeads = await metaClient.getAllPages<RawLead>(
          `/${ad.id}/leads`,
          {
            fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,field_data',
            filtering: JSON.stringify([
              { field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix },
              { field: 'time_created', operator: 'LESS_THAN', value: untilUnix },
            ]),
          }
        );
        for (const raw of adLeads) {
          allLeads.push(parseLeadFlexible(raw));
        }
      } catch (err: any) {
        logger.warn({ adId: ad.id, err: err.message }, 'Ad uchun leadlar olinmadi');
      }
    }

    logger.info({ totalLeads: allLeads.length }, '📥 Barcha leadlar olindi');

    // Sana bo'yicha leadlar group
    const leadsByDate = new Map<string, ParsedLead[]>();
    for (const lead of allLeads) {
      const localDate = format(toZonedTime(lead.createdTime, env.TZ), 'yyyy-MM-dd');
      if (!leadsByDate.has(localDate)) leadsByDate.set(localDate, []);
      leadsByDate.get(localDate)!.push(lead);
    }

    // Kunlik spend Map
    const spendByDate = new Map<string, number>();
    for (const ins of c2Insights) {
      spendByDate.set(ins.date_start, parseFloat(ins.spend || '0'));
    }

    // Barcha sanalar (leadlar + spend birlashtirilgan)
    const allDates = new Set<string>([...leadsByDate.keys(), ...spendByDate.keys()]);
    for (const dateStr of allDates) {
      try {
        const leads = leadsByDate.get(dateStr) ?? [];
        const spend = spendByDate.get(dateStr) ?? 0;
        await processCampaign2Day(dateStr, leads, spend);
        campaign2Days++;
      } catch (err: any) {
        logger.error({ dateStr, err: err.message }, 'Campaign 2 kun ishlash xatosi');
        errors.push(`C2 ${dateStr}: ${err.message}`);
      }
    }

    logger.info({ campaign2Days }, '✅ Campaign 2 backfill tugadi');
  } catch (err: any) {
    logger.error({ err: err.message }, '❌ Campaign 2 backfill yiqildi');
    errors.push(`Campaign 2: ${err.message}`);
  }

  return { total: days, campaign1Days, campaign2Days, errors };
}

async function processCampaign1Day(dateStr: string, rows: any[]): Promise<void> {
  const reportDate = fromZonedTime(new Date(`${dateStr}T00:00:00`), env.TZ);

  const report = await prisma.dailyReport.upsert({
    where: { reportDate_campaignType: { reportDate, campaignType: CampaignType.CAMPAIGN_1 } },
    create: {
      reportDate,
      campaignType: CampaignType.CAMPAIGN_1,
      campaignId: env.META_CAMPAIGN_1_ID,
      status: ReportStatus.FETCHING,
    },
    update: { status: ReportStatus.FETCHING },
  });

  await prisma.branchStat.deleteMany({ where: { reportId: report.id } });

  let totalSpend = 0, totalLeads = 0, totalReach = 0, totalImpressions = 0, totalClicks = 0;

  for (const ins of rows) {
    const leads = insightsService.extractLeads(ins.actions);
    const clicks = insightsService.extractLinkClicks(ins.actions);
    const spend = parseFloat(ins.spend || '0');
    const impressions = parseInt(ins.impressions || '0', 10);
    const reach = parseInt(ins.reach || '0', 10);
    const cpm = parseFloat(ins.cpm || '0');
    const ctr = parseFloat(ins.ctr || '0');
    const freq = parseFloat(ins.frequency || '0');

    await prisma.branchStat.create({
      data: {
        reportId: report.id,
        branchName: extractBranch(ins.adset_name),
        adsetId: ins.adset_id,
        adsetName: ins.adset_name,
        spend: new Prisma.Decimal(spend.toFixed(2)),
        leads,
        cpl: new Prisma.Decimal((leads > 0 ? spend / leads : 0).toFixed(2)),
        impressions,
        reach,
        cpm: new Prisma.Decimal(cpm.toFixed(4)),
        linkClicks: clicks,
        ctr: new Prisma.Decimal(ctr.toFixed(4)),
        frequency: new Prisma.Decimal(freq.toFixed(4)),
        isAllocated: false,
      },
    });

    totalSpend += spend;
    totalLeads += leads;
    totalReach += reach;
    totalImpressions += impressions;
    totalClicks += clicks;
  }

  await prisma.dailyReport.update({
    where: { id: report.id },
    data: {
      totalSpend: new Prisma.Decimal(totalSpend.toFixed(2)),
      totalLeads,
      totalReach,
      totalImpressions,
      totalLinkClicks: totalClicks,
      status: ReportStatus.COMPLETED,
    },
  });

  await sheetsService.syncReportsForDate(reportDate);
  logger.info({ date: dateStr, totalLeads, totalSpend }, '[C1] kun yozildi');
}

async function processCampaign2Day(
  dateStr: string,
  leads: ParsedLead[],
  totalSpend: number
): Promise<void> {
  const reportDate = fromZonedTime(new Date(`${dateStr}T00:00:00`), env.TZ);

  const report = await prisma.dailyReport.upsert({
    where: { reportDate_campaignType: { reportDate, campaignType: CampaignType.CAMPAIGN_2 } },
    create: {
      reportDate,
      campaignType: CampaignType.CAMPAIGN_2,
      campaignId: env.META_CAMPAIGN_2_ID,
      status: ReportStatus.FETCHING,
    },
    update: { status: ReportStatus.FETCHING },
  });

  // Raw leadlarni saqlash
  for (const lead of leads) {
    await prisma.leadFormResponse.upsert({
      where: { leadId: lead.leadId },
      create: {
        leadId: lead.leadId,
        campaignId: env.META_CAMPAIGN_2_ID,
        adsetId: lead.adsetId ?? undefined,
        formId: lead.formId,
        branchName: lead.branchName,
        rawFieldData: lead.rawFields,
        createdTime: lead.createdTime,
      },
      update: { branchName: lead.branchName, rawFieldData: lead.rawFields },
    });
  }

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
      status: ReportStatus.COMPLETED,
    },
  });

  await sheetsService.syncReportsForDate(reportDate);
  logger.info({ date: dateStr, leads: leads.length, totalSpend }, '[C2] kun yozildi');
}

function extractBranch(adsetName: string): string {
  const match = adsetName.match(/\[([^\]]+)\]/);
  if (match) {
    return match[1].replace(/\s*\d+\s*KM/gi, '').trim();
  }
  return adsetName.trim();
}

function parseLeadFlexible(raw: RawLead): ParsedLead {
  const fields: Record<string, string> = {};
  for (const f of raw.field_data) {
    fields[f.name.toLowerCase().trim()] = (f.values?.[0] ?? '').trim();
  }
  let branchName: string | null = null;
  for (const key of Object.keys(fields)) {
    if (BRANCH_FIELD_KEYWORDS.some(kw => key.includes(kw))) {
      branchName = fields[key];
      break;
    }
  }
  return {
    leadId: raw.id,
    createdTime: new Date(raw.created_time),
    adsetId: raw.adset_id ?? null,
    formId: raw.form_id,
    branchName,
    rawFields: fields,
  };
}

// CLI entry
if (require.main === module) {
  (async () => {
    const days = parseInt(process.argv[2] ?? '30', 10);
    try {
      const result = await runFastBackfill(days);
      console.log('\n=== BACKFILL RESULTS ===');
      console.log(`Campaign 1 kunlar: ${result.campaign1Days}`);
      console.log(`Campaign 2 kunlar: ${result.campaign2Days}`);
      if (result.errors.length > 0) {
        console.log(`\nXatolar: ${result.errors.length}`);
        for (const e of result.errors.slice(0, 5)) console.log(`  - ${e}`);
      }
    } catch (err: any) {
      logger.error({ err }, 'Backfill yiqildi');
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
      process.exit(process.exitCode ?? 0);
    }
  })();
}
