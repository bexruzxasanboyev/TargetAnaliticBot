import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { CampaignType, type BranchStat } from '@prisma/client';
import { format } from 'date-fns';
import { withRetry } from '../lib/retry';

// 5 ta rasmiy filial
const ALLOWED_BRANCHES = ['Algoritm', 'Beruniy', 'Mirobod', "Qo'yliq", 'Sergeli'];

interface CombinedBranch {
  branch_name: string;
  leads: number;
  spend: number;
  cpl: number;
}

/**
 * Combined hisobotni Google Sheets'ga webhook orqali yuborish.
 * Campaign 1 va Campaign 2 ni filial bo'yicha BIRLASHTIRADI.
 */
export class SheetsService {
  isEnabled(): boolean {
    return !!env.SHEETS_WEBHOOK_URL;
  }

  /**
   * Bitta kunlik combined hisobotni yuborish.
   */
  async syncReportsForDate(reportDate: Date): Promise<void> {
    if (!this.isEnabled()) {
      logger.debug('Sheets webhook configurated emas — skip');
      return;
    }

    const reports = await prisma.dailyReport.findMany({
      where: { reportDate },
      include: { branches: true },
    });

    if (reports.length === 0) return;

    const c1 = reports.find(r => r.campaignType === CampaignType.CAMPAIGN_1);
    const c2 = reports.find(r => r.campaignType === CampaignType.CAMPAIGN_2);

    // Combine C1 + C2 per filial
    const combined = this.combineCampaigns(c1?.branches ?? [], c2?.branches ?? []);

    if (combined.length === 0) {
      logger.warn({ reportDate }, 'Combined branches bo\'sh');
      return;
    }

    const dateStr = format(reportDate, 'yyyy-MM-dd');
    const updatedAt = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

    const payload = {
      secret: env.SHEETS_WEBHOOK_SECRET,
      date: dateStr,
      updated_at: updatedAt,
      combined_branches: combined,
    };

    try {
      const res = await withRetry(
        () =>
          axios.post(env.SHEETS_WEBHOOK_URL!, payload, {
            timeout: 30_000,
            headers: { 'Content-Type': 'application/json' },
          }),
        { maxAttempts: 3, baseDelay: 2000 }
      );
      if (res.data?.ok) {
        logger.info({ date: dateStr, branches: combined.length }, '✅ Combined sheets sync');
      } else {
        logger.warn({ date: dateStr, response: res.data }, '⚠️ Sheets javobi');
      }
    } catch (err: any) {
      logger.error(
        { err: err.message, date: dateStr },
        '❌ Sheets webhook xatosi'
      );
    }
  }

  /**
   * Campaign 1 (direct) + Campaign 2 (lead form, proportional) ni filial bo'yicha qo'shish
   */
  private combineCampaigns(
    c1Branches: BranchStat[],
    c2Branches: BranchStat[]
  ): CombinedBranch[] {
    const map = new Map<string, { leads: number; spend: number }>();

    // 5 filialdan boshqasi qo'shilmaydi
    for (const b of c1Branches) {
      if (!ALLOWED_BRANCHES.includes(b.branchName)) continue;
      const cur = map.get(b.branchName) ?? { leads: 0, spend: 0 };
      cur.leads += b.leads;
      cur.spend += Number(b.spend);
      map.set(b.branchName, cur);
    }

    for (const b of c2Branches) {
      if (!ALLOWED_BRANCHES.includes(b.branchName)) continue;
      const cur = map.get(b.branchName) ?? { leads: 0, spend: 0 };
      cur.leads += b.leads;
      cur.spend += Number(b.spend);
      map.set(b.branchName, cur);
    }

    const result: CombinedBranch[] = [];
    for (const branch of ALLOWED_BRANCHES) {
      const d = map.get(branch);
      if (d) {
        result.push({
          branch_name: branch,
          leads: d.leads,
          spend: Number(d.spend.toFixed(2)),
          cpl: d.leads > 0 ? Number((d.spend / d.leads).toFixed(2)) : 0,
        });
      }
    }
    return result;
  }

  async syncMultipleDates(dates: Date[]): Promise<void> {
    if (!this.isEnabled()) return;
    for (const d of dates) await this.syncReportsForDate(d);
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    if (!this.isEnabled()) {
      return { ok: false, message: 'SHEETS_WEBHOOK_URL yo\'q' };
    }
    try {
      const res = await axios.post(
        env.SHEETS_WEBHOOK_URL!,
        { secret: env.SHEETS_WEBHOOK_SECRET, ping: true },
        { timeout: 15_000, headers: { 'Content-Type': 'application/json' } }
      );
      if (res.data?.ok) return { ok: true, message: `✅ ${res.data.message || 'pong'}` };
      return { ok: false, message: `⚠️ ${JSON.stringify(res.data)}` };
    } catch (err: any) {
      return { ok: false, message: `❌ ${err.message}` };
    }
  }

  async init(): Promise<void> { /* noop */ }
}

export const sheetsService = new SheetsService();
