import type { DailyReport, BranchStat } from '@prisma/client';
import { CampaignType } from '@prisma/client';
import { format } from 'date-fns';
import { BRANCH_NORMALIZATION, canonicalizeName } from '../config/constants';

type ReportWithBranches = DailyReport & { branches: BranchStat[] };

export interface FormatOptions {
  isToday?: boolean;
}

interface Row {
  branchName: string;
  leads: number;
  spend: number;
  cpl: number;
  impressions: number;
  reach: number;
  ctr: number;
  linkClicks: number;
}

/**
 * Telegram uchun chiroyli hisobot generator.
 * Har bir adset (segment) alohida qator sifatida ko'rsatiladi.
 */
export class TelegramFormatter {
  format(reports: ReportWithBranches[], options: FormatOptions = {}): string {
    if (reports.length === 0) {
      return options.isToday
        ? '⚠️ Bugungi kun uchun ma\'lumot topilmadi.'
        : '⚠️ Kechagi kun uchun hisobot topilmadi.';
    }

    // reportDate UTC-yarim tunda saqlanadi — UTC bo'yicha o'qiymiz (server TZ ta'sir qilmasin).
    const reportDate = reports[0].reportDate.toISOString().slice(0, 10);
    const c1 = reports.find(r => r.campaignType === CampaignType.CAMPAIGN_1);
    const c2 = reports.find(r => r.campaignType === CampaignType.CAMPAIGN_2);

    const rows = this.buildRows(c1?.branches ?? [], c2?.branches ?? []);

    let msg = '';
    if (options.isToday) {
      const now = format(new Date(), 'HH:mm');
      msg += `📊 <b>${reportDate} (BUGUN — ${now} gacha)</b>\n`;
      msg += `<i>⚡ Live statistika</i>\n`;
    } else {
      msg += `📊 <b>${reportDate} | TARGET HISOBOTI</b>\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (rows.length === 0) {
      msg += `⚠️ Ma'lumot yo'q.\n`;
      return msg;
    }

    for (const r of rows) {
      msg += this.formatRow(r);
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += this.formatTotal(rows);

    return msg;
  }

  private buildRows(c1: BranchStat[], c2: BranchStat[]): Row[] {
    const map = new Map<string, Row>();

    const add = (b: BranchStat) => {
      const name = this.normalizeBranchName(b.branchName);
      const cur = map.get(name) ?? {
        branchName: name,
        leads: 0, spend: 0, cpl: 0,
        impressions: 0, reach: 0, ctr: 0, linkClicks: 0,
      };
      cur.leads += b.leads;
      cur.spend += Number(b.spend);
      cur.impressions += b.impressions;
      cur.reach += b.reach;
      cur.linkClicks += b.linkClicks;
      // CTR — impressions bo'yicha vaznli o'rtacha (vaqtincha yig'indi, pastda bo'linadi)
      cur.ctr += Number(b.ctr) * b.impressions;
      map.set(name, cur);
    };

    for (const b of c1) add(b);
    for (const b of c2) add(b);

    const rows = [...map.values()].filter(r => r.leads > 0 || r.spend > 0);
    for (const r of rows) {
      r.spend = Number(r.spend.toFixed(2));
      r.cpl = r.leads > 0 ? Number((r.spend / r.leads).toFixed(2)) : 0;
      r.ctr = r.impressions > 0 ? r.ctr / r.impressions : 0;
    }
    return rows.sort((a, b) => b.leads - a.leads || b.spend - a.spend);
  }

  /** Har xil yozilgan nomlarni bitta guruhga keltirish (eski DB yozuvlari uchun ham) */
  private normalizeBranchName(name: string): string {
    const canon = canonicalizeName(name);
    for (const [key, value] of Object.entries(BRANCH_NORMALIZATION)) {
      if (canon.includes(key)) return value;
    }
    return name;
  }

  private formatRow(r: Row): string {
    return (
      `🏢 <b>${this.escape(r.branchName)}</b>\n` +
      `   ├ 📩 Leads: <b>${r.leads}</b>\n` +
      `   ├ 💰 Spend: <b>${this.fmtSum(r.spend)}</b>\n` +
      `   └ 💵 CPL: <b>${this.fmtSum(r.cpl)}</b>\n\n`
    );
  }

  private formatTotal(rows: Row[]): string {
    const totalLeads = rows.reduce((s, b) => s + b.leads, 0);
    const totalSpend = rows.reduce((s, b) => s + b.spend, 0);
    const totalImpr = rows.reduce((s, b) => s + b.impressions, 0);
    const totalReach = rows.reduce((s, b) => s + b.reach, 0);
    const totalClicks = rows.reduce((s, b) => s + b.linkClicks, 0);
    const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    // CTR — impressions bo'yicha vaznli o'rtacha
    const avgCtr = totalImpr > 0
      ? rows.reduce((s, b) => s + b.ctr * b.impressions, 0) / totalImpr
      : 0;

    let msg = `📈 <b>UMUMIY NATIJA</b>\n`;
    msg += `📩 Leadlar: <b>${totalLeads}</b>\n`;
    msg += `💰 Spend: <b>${this.fmtSum(totalSpend)}</b>\n`;
    msg += `💵 CPL: <b>${this.fmtSum(avgCpl)}</b>\n`;
    if (totalImpr > 0) {
      msg += `👁 Impressions: <b>${totalImpr.toLocaleString('en-US')}</b>\n`;
      msg += `👥 Reach: <b>${totalReach.toLocaleString('en-US')}</b>\n`;
      msg += `🔗 Link Clicks: <b>${totalClicks.toLocaleString('en-US')}</b>\n`;
      msg += `📈 CTR: <b>${avgCtr.toFixed(2)}%</b>\n`;
    }
    return msg;
  }

  private fmtSum(value: number): string {
    if (isNaN(value)) return `$0.00`;
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private escape(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export const telegramFormatter = new TelegramFormatter();
