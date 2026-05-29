import type { DailyReport, BranchStat } from '@prisma/client';
import { CampaignType } from '@prisma/client';
import { format } from 'date-fns';
import { env } from '../config/env';

type ReportWithBranches = DailyReport & { branches: BranchStat[] };

export interface FormatOptions {
  isToday?: boolean;
}

const ALLOWED_BRANCHES = ['Algoritm', 'Beruniy', 'Mirobod', "Qo'yliq", 'Sergeli'];

interface CombinedBranch {
  branchName: string;
  leads: number;
  spend: number;
  cpl: number;
}

/**
 * Telegram uchun chiroyli combined hisobot generator.
 * Campaign 1 + Campaign 2 birlashtirilgan, filial bo'yicha.
 */
export class TelegramFormatter {
  format(reports: ReportWithBranches[], options: FormatOptions = {}): string {
    if (reports.length === 0) {
      return options.isToday
        ? '⚠️ Bugungi kun uchun ma\'lumot topilmadi.'
        : '⚠️ Kechagi kun uchun hisobot topilmadi.';
    }

    const reportDate = format(reports[0].reportDate, 'yyyy-MM-dd');
    const c1 = reports.find(r => r.campaignType === CampaignType.CAMPAIGN_1);
    const c2 = reports.find(r => r.campaignType === CampaignType.CAMPAIGN_2);

    const combined = this.combine(c1?.branches ?? [], c2?.branches ?? []);

    let msg = '';
    if (options.isToday) {
      const now = format(new Date(), 'HH:mm');
      msg += `📊 <b>${reportDate} (BUGUN — ${now} gacha)</b>\n`;
      msg += `<i>⚡ Live statistika</i>\n`;
    } else {
      msg += `📊 <b>${reportDate} | UMUMIY HISOBOT</b>\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (combined.length === 0) {
      msg += `⚠️ Filial bo'yicha ma'lumot yo'q.\n`;
      return msg;
    }

    // Filiallar bo'yicha
    for (const b of combined) {
      msg += this.formatBranch(b);
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += this.formatTotal(combined);

    return msg;
  }

  private combine(c1: BranchStat[], c2: BranchStat[]): CombinedBranch[] {
    const map = new Map<string, { leads: number; spend: number }>();

    for (const b of c1) {
      if (!ALLOWED_BRANCHES.includes(b.branchName)) continue;
      const cur = map.get(b.branchName) ?? { leads: 0, spend: 0 };
      cur.leads += b.leads;
      cur.spend += Number(b.spend);
      map.set(b.branchName, cur);
    }
    for (const b of c2) {
      if (!ALLOWED_BRANCHES.includes(b.branchName)) continue;
      const cur = map.get(b.branchName) ?? { leads: 0, spend: 0 };
      cur.leads += b.leads;
      cur.spend += Number(b.spend);
      map.set(b.branchName, cur);
    }

    const result: CombinedBranch[] = [];
    for (const branch of ALLOWED_BRANCHES) {
      const d = map.get(branch);
      if (d && (d.leads > 0 || d.spend > 0)) {
        result.push({
          branchName: branch,
          leads: d.leads,
          spend: Number(d.spend.toFixed(2)),
          cpl: d.leads > 0 ? Number((d.spend / d.leads).toFixed(2)) : 0,
        });
      }
    }
    // Lead miqdori bo'yicha kamayuvchi sort
    return result.sort((a, b) => b.leads - a.leads);
  }

  private formatBranch(b: CombinedBranch): string {
    return (
      `🏢 <b>${this.escape(b.branchName)}</b>\n` +
      `   ├ 📩 Leads: <b>${b.leads}</b>\n` +
      `   ├ 💰 Spend: <b>${this.fmtSum(b.spend)}</b>\n` +
      `   └ 💵 CPL: <b>${this.fmtSum(b.cpl)}</b>\n\n`
    );
  }

  private formatTotal(branches: CombinedBranch[]): string {
    const totalLeads = branches.reduce((s, b) => s + b.leads, 0);
    const totalSpend = branches.reduce((s, b) => s + b.spend, 0);
    const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

    let msg = `📈 <b>UMUMIY NATIJA</b>\n`;
    msg += `📩 Leadlar: <b>${totalLeads}</b>\n`;
    msg += `💰 Spend: <b>${this.fmtSum(totalSpend)}</b>\n`;
    msg += `💵 CPL: <b>${this.fmtSum(avgCpl)}</b>\n`;
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
