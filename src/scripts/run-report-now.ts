/**
 * Manual ravishda kechagi kun hisobotini ishga tushirish.
 *
 * Foydalanish:
 *   npm run report:run
 */
import { runDailyReportJob } from '../jobs/daily-report.job';
import { prisma } from '../lib/prisma';
import { bot } from '../telegram/bot';
import { logger } from '../lib/logger';

(async () => {
  try {
    await runDailyReportJob();
    logger.info('✅ Manual run muvaffaqiyatli');
  } catch (err) {
    logger.error({ err }, '❌ Manual run muvaffaqiyatsiz');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    bot.stop('SIGTERM');
    process.exit(process.exitCode ?? 0);
  }
})();
