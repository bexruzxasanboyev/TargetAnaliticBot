/**
 * Account-level backfill — bitta reklama hisobi bo'yicha.
 *
 * Har bir ADSET alohida qator (segment) sifatida hisoblanadi.
 * Adset nomidagi kvadrat qavs ichidagi qism (masalan "[1-4-sinflar]")
 * segment nomi sifatida ishlatiladi; qavs bo'lmasa — to'liq adset nomi.
 *
 * Qotirilgan filial ro'yxati YO'Q — istalgan hisob/campaign bilan ishlaydi.
 *
 * Foydalanish: npm run backfill:account [kunlar]
 */
import { metaClient } from '../meta/client';
import { insightsService } from '../meta/insights.service';
import { sheetsService } from '../google/sheets.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { env } from '../config/env';
import { CampaignType, Prisma, ReportStatus } from '@prisma/client';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { AdsetInsight } from '../meta/types';

export async function runAccountBackfill(days: number = 30): Promise<{
  total: number;
  c1Days: number;
  c2Days: number;
  totalSpend: number;
  totalLeads: number;
  errors: string[];
}> {
  logger.info({ days }, '🚀 Account backfill (adset bo\'yicha)');

  const nowLocal = toZonedTime(new Date(), env.TZ);
  const yesterdayLocal = subDays(nowLocal, 1);
  const startLocal = subDays(nowLocal, days);
  const sinceDate = format(startLocal, 'yyyy-MM-dd');
  const untilDate = format(yesterdayLocal, 'yyyy-MM-dd');

  const accountId = env.META_AD_ACCOUNT_ID;
  logger.info({ accountId, sinceDate, untilDate }, 'Sana oralig\'i');

  const errors: string[] = [];
  let c1Days = 0;
  let totalSpend = 0;
  let totalLeads = 0;

  try {
    const insights = await metaClient.getAllPages<AdsetInsight & {
      date_start: string;
      campaign_name?: string;
    }>(
      `/${accountId}/insights`,
      {
        level: 'adset',
        time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
        time_increment: 1,
        fields: 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,reach,frequency,cpm,ctr,actions,date_start',
        action_breakdowns: 'action_type',
        filtering: JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: 0 }]),
      }
    );

    logger.info({ totalRows: insights.length }, '📊 Account insights olindi');

    // Group: date → segment(label) → adsets[]
    const byDate = new Map<string, Map<string, typeof insights>>();
    for (const ins of insights) {
      const label = branchLabel(ins.adset_name);
      if (!byDate.has(ins.date_start)) byDate.set(ins.date_start, new Map());
      const m = byDate.get(ins.date_start)!;
      if (!m.has(label)) m.set(label, [] as typeof insights);
      m.get(label)!.push(ins);
    }

    for (const [dateStr, branchMap] of byDate.entries()) {
      try {
        const r = await processC1Day(dateStr, branchMap);
        c1Days++;
        totalSpend += r.spend;
        totalLeads += r.leads;
      } catch (err: any) {
        errors.push(`${dateStr}: ${err.message}`);
      }
    }

    logger.info({ c1Days, totalSpend, totalLeads }, '✅ Backfill tugadi');
  } catch (err: any) {
    errors.push(`${err.message}`);
    logger.error({ err: err.message }, '❌ Backfill yiqildi');
  }

  // Bitta campaign rejimi — Campaign 2 (lead-form proporsional taqsimlash) ishlatilmaydi.
  return { total: days, c1Days, c2Days: 0, totalSpend, totalLeads, errors };
}

/**
 * Adset nomidan o'qish uchun qulay segment nomini ajratish.
 * "Tof - B -Namangan - 22.05 [1-4-sinflar]" → "1-4-sinflar"
 * Qavs bo'lmasa — to'liq adset nomi.
 */
function branchLabel(adsetName: string): string {
  const name = (adsetName || '').trim();
  const bracket = name.match(/\[([^\]]+)\]/);
  if (bracket) {
    const inner = bracket[1].replace(/\s*\d+\s*KM/gi, '').trim();
    if (inner) return inner;
  }
  return name || 'Nomalum';
}

async function processC1Day(
  dateStr: string,
  branchMap: Map<string, any[]>
): Promise<{ spend: number; leads: number }> {
  // Kalendar sanani UTC-yarim tunda saqlaymiz — @db.Date timezone shift'ini oldini oladi.
  const reportDate = new Date(`${dateStr}T00:00:00.000Z`);

  const report = await prisma.dailyReport.upsert({
    where: { reportDate_campaignType: { reportDate, campaignType: CampaignType.CAMPAIGN_1 } },
    create: {
      reportDate,
      campaignType: CampaignType.CAMPAIGN_1,
      campaignId: env.META_AD_ACCOUNT_ID,
      status: ReportStatus.FETCHING,
    },
    update: { status: ReportStatus.FETCHING },
  });

  await prisma.branchStat.deleteMany({ where: { reportId: report.id } });

  let totalSpend = 0, totalLeads = 0, totalImpressions = 0, totalReach = 0, totalClicks = 0;

  for (const [branchName, adsets] of branchMap.entries()) {
    if (!adsets || adsets.length === 0) continue;

    let spend = 0, leads = 0, impressions = 0, reach = 0, clicks = 0;
    let cpmSum = 0, ctrSum = 0, freqSum = 0;
    const adsetIds: string[] = [];

    for (const ins of adsets) {
      spend += parseFloat(ins.spend || '0');
      leads += insightsService.extractLeads(ins.actions);
      clicks += insightsService.extractLinkClicks(ins.actions);
      impressions += parseInt(ins.impressions || '0', 10);
      reach += parseInt(ins.reach || '0', 10);
      cpmSum += parseFloat(ins.cpm || '0');
      ctrSum += parseFloat(ins.ctr || '0');
      freqSum += parseFloat(ins.frequency || '0');
      adsetIds.push(ins.adset_id);
    }

    const cpl = leads > 0 ? spend / leads : 0;

    await prisma.branchStat.create({
      data: {
        reportId: report.id,
        branchName,
        adsetId: adsetIds.join(','),
        adsetName: `${adsets.length} adset(s)`,
        spend: new Prisma.Decimal(spend.toFixed(2)),
        leads,
        cpl: new Prisma.Decimal(cpl.toFixed(2)),
        impressions,
        reach,
        cpm: new Prisma.Decimal((adsets.length > 0 ? cpmSum / adsets.length : 0).toFixed(4)),
        linkClicks: clicks,
        ctr: new Prisma.Decimal((adsets.length > 0 ? ctrSum / adsets.length : 0).toFixed(4)),
        frequency: new Prisma.Decimal((adsets.length > 0 ? freqSum / adsets.length : 0).toFixed(4)),
        isAllocated: false,
      },
    });

    totalSpend += spend;
    totalLeads += leads;
    totalImpressions += impressions;
    totalReach += reach;
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
  logger.info({ date: dateStr, totalSpend, totalLeads }, '[backfill] kun yozildi');
  return { spend: totalSpend, leads: totalLeads };
}

if (require.main === module) {
  (async () => {
    const days = parseInt(process.argv[2] ?? '30', 10);
    try {
      const result = await runAccountBackfill(days);
      console.log('\n=== ACCOUNT BACKFILL ===');
      console.log(`Kunlar: ${result.c1Days}`);
      console.log(`Jami spend: $${result.totalSpend.toFixed(2)}`);
      console.log(`Jami leadlar: ${result.totalLeads}`);
      if (result.errors.length > 0) {
        console.log(`\nXatolar: ${result.errors.length}`);
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
