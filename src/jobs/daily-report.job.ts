import { sendDailyReport, sendErrorNotification } from '../telegram/sender';
import { logger } from '../lib/logger';

/**
 * Har kuni 08:00 da ishlaydi:
 *   1. Account-level kechagi kun ma'lumotini Meta API'dan oladi (strict 5 filial)
 *   2. DB'ga yozadi
 *   3. Google Sheets'ga combined yuboradi
 *   4. Telegram guruh(lar)ga umumiy hisobotni yuboradi
 */
export async function runDailyReportJob(): Promise<void> {
  const start = Date.now();
  logger.info('🕐 Daily report job boshlandi (strict 5-filial, combined)');

  try {
    // Account-level backfill bir kun uchun (yesterday)
    // Bu logika campaign rotation'ga chidamli — har doim active campaign'lardan oladi
    const { runAccountBackfill } = await import('../scripts/account-backfill');
    const result = await runAccountBackfill(1);

    logger.info(
      {
        c1Days: result.c1Days,
        c2Days: result.c2Days,
        totalSpend: result.totalSpend,
        totalLeads: result.totalLeads,
        errors: result.errors.length,
      },
      '📊 Backfill yakuni'
    );

    // Telegram guruhlarga yuborish
    if (result.c1Days > 0 || result.c2Days > 0) {
      await sendDailyReport();
    } else {
      logger.warn('Kechagi kun uchun ma\'lumot yo\'q — Telegram ga yuborilmaydi');
    }

    // Xatolar bo'lsa, adminlarga alert
    if (result.errors.length > 0) {
      const errMsg = `Kechagi kun backfill xatolari (${result.errors.length}):\n${result.errors.slice(0, 3).join('\n')}`;
      await sendErrorNotification(new Error(errMsg));
    }

    logger.info(
      { duration: Date.now() - start, c1: result.c1Days, c2: result.c2Days },
      '✅ Daily job muvaffaqiyatli'
    );
  } catch (err: any) {
    logger.error({ err: err.message }, '❌ Daily job critical xatolik');
    try {
      await sendErrorNotification(err);
    } catch {}
    throw err;
  }
}
