import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { bot } from './telegram/bot';
import { startScheduler, stopScheduler } from './jobs/scheduler';
import { tokenService } from './meta/token.service';
import { chatService } from './telegram/chat.service';

async function main(): Promise<void> {
  logger.info(
    {
      env: env.NODE_ENV,
      tz: env.TZ,
      cron: env.CRON_SCHEDULE,
    },
    '🚀 Target Analytics Bot ishga tushmoqda...'
  );

  // 1. Database ulanish
  await prisma.$connect();
  logger.info('✅ Database ulandi');

  // 1.5. Default chat'ni seed qilish (faqat birinchi marta)
  try {
    await chatService.seedDefaultIfEmpty();
  } catch (err) {
    logger.warn({ err }, 'Default chat seed xatosi (davom etamiz)');
  }

  // 2. Token validatsiya
  try {
    const health = await tokenService.checkTokenHealth();
    logger.info({ health: health.message }, '🔑 Token holati');
    if (!health.isValid) {
      logger.error('Token invalid! Bot baribir ishga tushadi, lekin Meta API so\'rovlari yiqiladi');
    }
  } catch (err) {
    logger.warn({ err }, 'Token holatini tekshirib bo\'lmadi (davom etamiz)');
  }

  // 3. Telegram bot (fire-and-forget — launch() polling tugashini kutadi)
  bot.launch({
    dropPendingUpdates: true,
  }).catch(err => {
    logger.fatal({ err }, '💥 Telegram bot launch xatosi');
    process.exit(1);
  });
  logger.info('✅ Telegram bot ishga tushdi (polling started)');

  // 4. Scheduler
  startScheduler();

  // 5. Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, '🛑 Shutdown signal qabul qilindi');
    stopScheduler();
    bot.stop(signal);
    prisma.$disconnect().finally(() => process.exit(0));
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled rejection');
  });

  process.on('uncaughtException', err => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch(err => {
  logger.fatal({ err }, '💥 Bot ishga tushishda kritik xato');
  process.exit(1);
});
