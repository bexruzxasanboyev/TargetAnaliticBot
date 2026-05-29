import { tokenService } from '../meta/token.service';
import { bot } from '../telegram/bot';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { adminService } from '../telegram/admin.service';

/**
 * Token health check job — har kuni 09:00 da ishlaydi.
 * 14 kundan kam qolsa, admin ga ogohlantirish yuboradi.
 */
export async function runTokenCheckJob(): Promise<void> {
  logger.info('🔑 Token health check boshlandi');

  const health = await tokenService.checkTokenHealth();
  logger.info({ health }, 'Token health natija');

  // Faqat muammoli holatlarda Telegram ga yuboramiz
  if (!health.isValid || (health.daysLeft !== null && health.daysLeft <= 14)) {
    const admins = await adminService.listAdmins();
    const targets: string[] = [];

    if (admins.length > 0) {
      targets.push(...admins.map(a => a.telegramUserId));
    } else if (env.TELEGRAM_ADMIN_ID) {
      targets.push(env.TELEGRAM_ADMIN_ID);
    } else if (env.TELEGRAM_CHAT_ID) {
      targets.push(env.TELEGRAM_CHAT_ID);
    }

    for (const target of targets) {
      try {
        await bot.telegram.sendMessage(
          target,
          `🔑 <b>Meta Token Holati</b>\n\n${health.message}`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.error({ err, target }, 'Token alert yuborilmadi');
      }
    }
  }
}
