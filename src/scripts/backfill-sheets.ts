/**
 * 30 kunlik backfill:
 *   - Har kun uchun Meta API'dan ma'lumot oladi
 *   - DB ga yozadi
 *   - Google Sheets'ga sync qiladi
 *
 * Foydalanish:
 *   npm run backfill:sheets [kunlar_soni]
 *   masalan: npm run backfill:sheets 30
 */
import { reportService } from '../reports/report.service';
import { sheetsService } from '../google/sheets.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getDayInTz } from '../lib/date';

export async function runBackfill(days: number = 30): Promise<{
  total: number;
  success: number;
  failed: number;
  errors: Array<{ daysAgo: number; error: string }>;
}> {
  logger.info({ days }, `📥 Backfill boshlandi: oxirgi ${days} kun`);
  await sheetsService.init();

  let success = 0;
  let failed = 0;
  const errors: Array<{ daysAgo: number; error: string }> = [];

  // daysAgo: 1 = kecha, days = eng eski kun
  for (let daysAgo = 1; daysAgo <= days; daysAgo++) {
    const { isoDate } = getDayInTz(daysAgo);
    logger.info({ daysAgo, date: isoDate }, `[${daysAgo}/${days}] kun qayta ishlanmoqda`);

    try {
      const result = await reportService.generateReports(daysAgo);
      const c1ok = result.campaign1.success;
      const c2ok = result.campaign2.success;

      if (c1ok || c2ok) {
        success++;
        logger.info({ daysAgo, c1ok, c2ok }, `✅ [${daysAgo}/${days}] tugadi`);
      } else {
        failed++;
        const errMsg = `c1: ${result.campaign1.error}, c2: ${result.campaign2.error}`;
        errors.push({ daysAgo, error: errMsg });
        logger.warn({ daysAgo, errMsg }, `⚠️ [${daysAgo}/${days}] ikkalasi ham xato`);
      }
    } catch (err: any) {
      failed++;
      errors.push({ daysAgo, error: err.message });
      logger.error({ err, daysAgo }, `❌ [${daysAgo}/${days}] critical error`);
    }
  }

  logger.info({ success, failed }, '🏁 Backfill tugadi');
  return { total: days, success, failed, errors };
}

// CLI entry point
if (require.main === module) {
  (async () => {
    const days = parseInt(process.argv[2] ?? '30', 10);
    try {
      const result = await runBackfill(days);
      console.log('\n=== BACKFILL RESULTS ===');
      console.log(`Total kunlar: ${result.total}`);
      console.log(`Muvaffaqiyatli: ${result.success}`);
      console.log(`Xato: ${result.failed}`);
      if (result.errors.length > 0) {
        console.log('\nXatolar:');
        for (const e of result.errors.slice(0, 5)) {
          console.log(`  daysAgo=${e.daysAgo}: ${e.error.slice(0, 100)}`);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Backfill yiqildi');
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
      process.exit(process.exitCode ?? 0);
    }
  })();
}
