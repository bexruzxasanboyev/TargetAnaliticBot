/**
 * Strict 5-filial backfill — faqat quyidagi filiallar:
 *   Algoritm, Beruniy, Mirobod, Qo'yliq, Sergeli
 *
 * Ikkala campaign uchun ham bir xil 5 filial.
 * Adset/Campaign nomida shu filialdan birortasi bo'lmasa — SKIP.
 *
 * Foydalanish: npm run backfill:account [kunlar]
 */
import { metaClient } from '../meta/client';
import { insightsService } from '../meta/insights.service';
import { aggregator } from '../reports/aggregator';
import { sheetsService } from '../google/sheets.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { env } from '../config/env';
import { CampaignType, Prisma, ReportStatus } from '@prisma/client';
import { format, subDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { AdsetInsight, RawLead, ParsedLead } from '../meta/types';

// 5 ta rasmiy filial — fixed order
const ALLOWED_BRANCHES = ['Algoritm', 'Beruniy', 'Mirobod', "Qo'yliq", 'Sergeli'];

// Mapping: lowercase variants → canonical name
const BRANCH_PATTERNS: Array<{ patterns: string[]; name: string }> = [
  { patterns: ['algoritm'], name: 'Algoritm' },
  { patterns: ['beruniy', 'beruni'], name: 'Beruniy' },
  { patterns: ['mirobod', 'mirabad'], name: 'Mirobod' },
  { patterns: ["qo'yliq", 'qoyliq', 'koyliq', "qo`yliq"], name: "Qo'yliq" },
  { patterns: ['sergeli'], name: 'Sergeli' },
];

const BRANCH_FIELD_KEYWORDS = ['filial', 'branch', 'manzil', 'address', 'location'];

export async function runAccountBackfill(days: number = 30): Promise<{
  total: number;
  c1Days: number;
  c2Days: number;
  totalSpend: number;
  totalLeads: number;
  errors: string[];
}> {
  logger.info({ days, branches: ALLOWED_BRANCHES }, '🚀 Strict 5-filial backfill');

  const nowLocal = toZonedTime(new Date(), env.TZ);
  const yesterdayLocal = subDays(nowLocal, 1);
  const startLocal = subDays(nowLocal, days);
  const sinceDate = format(startLocal, 'yyyy-MM-dd');
  const untilDate = format(yesterdayLocal, 'yyyy-MM-dd');

  const accountId = env.META_AD_ACCOUNT_ID;
  logger.info({ accountId, sinceDate, untilDate }, 'Sana oralig\'i');

  const errors: string[] = [];

  // ========== CAMPAIGN 1 ==========
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

    // Faqat 5 filialdan biriga tegishli adsetlarni saqlaymiz
    const filtered = insights
      .map(ins => ({ ...ins, _branch: extractBranchStrict(ins.adset_name, ins.campaign_name) }))
      .filter(ins => ins._branch !== null);

    logger.info(
      { filtered: filtered.length, skipped: insights.length - filtered.length },
      '🎯 Filial bo\'yicha filtered'
    );

    // Group: date → branch → adsets[]
    const byDate = new Map<string, Map<string, typeof filtered>>();
    for (const ins of filtered) {
      const branch = ins._branch!;
      if (!byDate.has(ins.date_start)) byDate.set(ins.date_start, new Map());
      const m = byDate.get(ins.date_start)!;
      if (!m.has(branch)) m.set(branch, [] as typeof filtered);
      m.get(branch)!.push(ins);
    }

    for (const [dateStr, branchMap] of byDate.entries()) {
      try {
        const r = await processC1Day(dateStr, branchMap);
        c1Days++;
        totalSpend += r.spend;
        totalLeads += r.leads;
      } catch (err: any) {
        errors.push(`C1 ${dateStr}: ${err.message}`);
      }
    }

    logger.info({ c1Days, totalSpend, totalLeads }, '✅ Campaign 1 tugadi');
  } catch (err: any) {
    errors.push(`C1: ${err.message}`);
    logger.error({ err: err.message }, '❌ Campaign 1 yiqildi');
  }

  // ========== CAMPAIGN 2: Lead Form ==========
  let c2Days = 0;
  try {
    // Lead form-style campaign-larni topish
    const c2Insights = await metaClient.getAllPages<any>(
      `/${accountId}/insights`,
      {
        level: 'campaign',
        time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
        time_increment: 1,
        fields: 'campaign_id,campaign_name,spend,date_start,actions',
        action_breakdowns: 'action_type',
        filtering: JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: 0 }]),
      }
    );

    const leadFormCampaignIds = new Set<string>();
    for (const ins of c2Insights) {
      const name = (ins.campaign_name ?? '').toLowerCase();
      if (
        name.includes('offlayn') ||
        name.includes('[f tash]') ||
        name.includes('umumiy')
      ) {
        leadFormCampaignIds.add(ins.campaign_id);
      }
    }
    logger.info({ count: leadFormCampaignIds.size }, 'Lead form campaigns topildi');

    // Kunlik spend (lead-form campaign-larga)
    const c2SpendByDate = new Map<string, number>();
    for (const ins of c2Insights) {
      if (!leadFormCampaignIds.has(ins.campaign_id)) continue;
      const d = ins.date_start;
      c2SpendByDate.set(d, (c2SpendByDate.get(d) ?? 0) + parseFloat(ins.spend ?? '0'));
    }

    // Lead-form campaign'lar ostidagi ads
    const allAds: { id: string }[] = [];
    for (const cid of leadFormCampaignIds) {
      try {
        const ads = await metaClient.getAllPages<{ id: string }>(`/${cid}/ads`, { fields: 'id' });
        allAds.push(...ads);
      } catch (err: any) {
        logger.warn({ cid, err: err.message }, 'Campaign ads xato');
      }
    }
    logger.info({ adCount: allAds.length }, '📊 Lead form ads');

    const sinceUnix = Math.floor(
      fromZonedTime(new Date(`${sinceDate}T00:00:00`), env.TZ).getTime() / 1000
    );
    const untilUnix = Math.floor(
      fromZonedTime(new Date(`${untilDate}T23:59:59`), env.TZ).getTime() / 1000
    );

    const allLeads: ParsedLead[] = [];
    for (const ad of allAds) {
      try {
        const leads = await metaClient.getAllPages<RawLead>(`/${ad.id}/leads`, {
          fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,field_data',
          filtering: JSON.stringify([
            { field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix },
            { field: 'time_created', operator: 'LESS_THAN', value: untilUnix },
          ]),
        });
        for (const raw of leads) {
          const parsed = parseLeadStrict(raw);
          // Faqat 5 ta filialdan birortasiga tegishli leadlar
          if (parsed.branchName && ALLOWED_BRANCHES.includes(parsed.branchName)) {
            allLeads.push(parsed);
          }
        }
      } catch (err: any) {
        logger.warn({ adId: ad.id }, 'Ad leads xato');
      }
    }
    logger.info({ leads: allLeads.length }, '📥 5-filial leadlar');

    // Group by date
    const leadsByDate = new Map<string, ParsedLead[]>();
    for (const lead of allLeads) {
      const d = format(toZonedTime(lead.createdTime, env.TZ), 'yyyy-MM-dd');
      if (!leadsByDate.has(d)) leadsByDate.set(d, []);
      leadsByDate.get(d)!.push(lead);
    }

    const allDates = new Set<string>([...leadsByDate.keys(), ...c2SpendByDate.keys()]);
    for (const dateStr of allDates) {
      try {
        const leads = leadsByDate.get(dateStr) ?? [];
        const spend = c2SpendByDate.get(dateStr) ?? 0;
        await processC2Day(dateStr, leads, spend);
        c2Days++;
      } catch (err: any) {
        errors.push(`C2 ${dateStr}: ${err.message}`);
      }
    }

    logger.info({ c2Days }, '✅ Campaign 2 tugadi');
  } catch (err: any) {
    errors.push(`C2: ${err.message}`);
    logger.error({ err: err.message }, '❌ Campaign 2 yiqildi');
  }

  return { total: days, c1Days, c2Days, totalSpend, totalLeads, errors };
}

/**
 * Strict branch extraction — faqat 5 ta filialdan biri yoki null
 * Avval adset name'da qidiradi, keyin campaign name'da.
 */
function extractBranchStrict(adsetName: string, campaignName?: string): string | null {
  const sources = [adsetName, campaignName ?? ''].map(s => s.toLowerCase());

  for (const src of sources) {
    for (const { patterns, name } of BRANCH_PATTERNS) {
      for (const p of patterns) {
        if (src.includes(p)) return name;
      }
    }
  }
  return null;
}

function parseLeadStrict(raw: RawLead): ParsedLead {
  const fields: Record<string, string> = {};
  for (const f of raw.field_data) {
    fields[f.name.toLowerCase().trim()] = (f.values?.[0] ?? '').trim();
  }

  let branchName: string | null = null;
  for (const key of Object.keys(fields)) {
    if (BRANCH_FIELD_KEYWORDS.some(kw => key.includes(kw)) && fields[key]) {
      branchName = normalizeBranch(fields[key]);
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

function normalizeBranch(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  for (const { patterns, name } of BRANCH_PATTERNS) {
    for (const p of patterns) {
      if (lower.includes(p)) return name;
    }
  }
  return null;
}

async function processC1Day(
  dateStr: string,
  branchMap: Map<string, any[]>
): Promise<{ spend: number; leads: number }> {
  const reportDate = fromZonedTime(new Date(`${dateStr}T00:00:00`), env.TZ);

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

  // Faqat 5 filialdan birortasi
  for (const branchName of ALLOWED_BRANCHES) {
    const adsets = branchMap.get(branchName);
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
  logger.info({ date: dateStr, totalSpend, totalLeads }, '[C1] kun yozildi');
  return { spend: totalSpend, leads: totalLeads };
}

async function processC2Day(
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
      campaignId: env.META_AD_ACCOUNT_ID,
      status: ReportStatus.FETCHING,
    },
    update: { status: ReportStatus.FETCHING },
  });

  for (const lead of leads) {
    await prisma.leadFormResponse.upsert({
      where: { leadId: lead.leadId },
      create: {
        leadId: lead.leadId,
        campaignId: env.META_AD_ACCOUNT_ID,
        adsetId: lead.adsetId ?? undefined,
        formId: lead.formId,
        branchName: lead.branchName,
        rawFieldData: lead.rawFields,
        createdTime: lead.createdTime,
      },
      update: { branchName: lead.branchName, rawFieldData: lead.rawFields },
    });
  }

  const aggregated = aggregator.allocateSpendByLeads(leads, totalSpend)
    .filter(a => ALLOWED_BRANCHES.includes(a.branchName));

  await prisma.branchStat.deleteMany({ where: { reportId: report.id } });

  for (const a of aggregated) {
    await prisma.branchStat.create({
      data: {
        reportId: report.id,
        branchName: a.branchName,
        spend: new Prisma.Decimal(a.spend.toFixed(2)),
        leads: a.leads,
        cpl: new Prisma.Decimal(a.cpl.toFixed(2)),
        impressions: 0, reach: 0,
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

if (require.main === module) {
  (async () => {
    const days = parseInt(process.argv[2] ?? '30', 10);
    try {
      const result = await runAccountBackfill(days);
      console.log('\n=== STRICT 5-FILIAL BACKFILL ===');
      console.log(`Filiallar: ${ALLOWED_BRANCHES.join(', ')}`);
      console.log(`Campaign 1 kunlar: ${result.c1Days}`);
      console.log(`Campaign 2 kunlar: ${result.c2Days}`);
      console.log(`Jami spend (C1): $${result.totalSpend.toFixed(2)}`);
      console.log(`Jami leadlar (C1): ${result.totalLeads}`);
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
