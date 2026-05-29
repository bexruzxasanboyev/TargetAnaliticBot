import { campaign1Service } from './campaign1.service';
import { campaign2Service } from './campaign2.service';
import { logger } from '../lib/logger';
import { getDayInTz } from '../lib/date';
import { prisma } from '../lib/prisma';
import { sheetsService } from '../google/sheets.service';

/**
 * Report orchestrator — ikkala campaign hisobotini parallel ishga tushiradi.
 * Bittasi yiqilsa ham, ikkinchisi tugaydi (Promise.allSettled).
 */
export class ReportService {
  /**
   * Hisobot generatsiyasi.
   * @param daysAgo 0=bugun, 1=kecha (default)
   */
  async generateReports(daysAgo: number = 1): Promise<{
    campaign1: { success: boolean; reportId?: string; error?: string };
    campaign2: { success: boolean; reportId?: string; error?: string };
  }> {
    const { isoDate } = getDayInTz(daysAgo);
    logger.info({ date: isoDate, daysAgo }, '🚀 Hisobot generatsiyasi boshlandi');

    const [c1, c2] = await Promise.allSettled([
      campaign1Service.generate(daysAgo),
      campaign2Service.generate(daysAgo),
    ]);

    const result = {
      campaign1:
        c1.status === 'fulfilled'
          ? { success: true, reportId: c1.value }
          : { success: false, error: extractError(c1.reason) },
      campaign2:
        c2.status === 'fulfilled'
          ? { success: true, reportId: c2.value }
          : { success: false, error: extractError(c2.reason) },
    };

    if (!result.campaign1.success) {
      logger.error({ error: result.campaign1.error }, '❌ Campaign 1 yiqildi');
    }
    if (!result.campaign2.success) {
      logger.error({ error: result.campaign2.error }, '❌ Campaign 2 yiqildi');
    }

    // Google Sheets'ga avto-sync (xato bo'lsa ham hisobotni buzmasligi uchun catch)
    if (result.campaign1.success || result.campaign2.success) {
      try {
        const { date } = getDayInTz(daysAgo);
        await sheetsService.syncReportsForDate(date);
      } catch (err) {
        logger.error({ err }, '⚠️ Sheets sync xatosi (hisobot saqlandi)');
      }
    }

    return result;
  }

  /** Backward compat — kechagi kun */
  async generateYesterdayReports() {
    return this.generateReports(1);
  }

  /**
   * Saqlangan hisobotlarni DB dan olish.
   * @param daysAgo 0=bugun, 1=kecha (default)
   */
  async getReports(daysAgo: number = 1) {
    const { date } = getDayInTz(daysAgo);
    return prisma.dailyReport.findMany({
      where: { reportDate: date },
      include: {
        branches: {
          orderBy: [{ leads: 'desc' }, { spend: 'desc' }],
        },
      },
      orderBy: { campaignType: 'asc' },
    });
  }

  /** Backward compat */
  async getYesterdayReports() {
    return this.getReports(1);
  }
}

function extractError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const reportService = new ReportService();
