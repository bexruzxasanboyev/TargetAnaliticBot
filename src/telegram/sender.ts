import { bot } from './bot';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { telegramFormatter } from './formatter';
import { logger } from '../lib/logger';
import { withRetry } from '../lib/retry';
import { reportService } from '../reports/report.service';
import { chatService } from './chat.service';
import { adminService } from './admin.service';
import { TELEGRAM_SAFE_CHUNK_SIZE } from '../config/constants';
import { TelegramSendError } from '../lib/errors';

/**
 * Hisobotni barcha aktiv chatlarga yuborish.
 * @param daysAgo 0=bugun, 1=kecha (default)
 */
export async function sendReport(daysAgo: number = 1): Promise<void> {
  const reports = await reportService.getReports(daysAgo);

  if (reports.length === 0) {
    logger.warn({ daysAgo }, 'Hisobot DB da topilmadi');
    return;
  }

  const chats = await chatService.listActiveChats();
  if (chats.length === 0) {
    logger.warn('Aktiv chat yo\'q — hisobot yuborilmaydi');
    return;
  }

  const message = telegramFormatter.format(reports, { isToday: daysAgo === 0 });
  const chunks = chunkMessage(message, TELEGRAM_SAFE_CHUNK_SIZE);

  const results: Array<{ chatId: string; success: boolean; messageId?: number; error?: string }> = [];

  for (const chat of chats) {
    try {
      let firstMessageId: number | null = null;

      for (const chunk of chunks) {
        const sent = await withRetry(
          () =>
            bot.telegram.sendMessage(chat.chatId, chunk, {
              parse_mode: 'HTML',
              message_thread_id: chat.threadId ? Number(chat.threadId) : undefined,
              link_preview_options: { is_disabled: true },
            }),
          { maxAttempts: 4, baseDelay: 2000 }
        );
        if (!firstMessageId) firstMessageId = sent.message_id;
      }

      results.push({
        chatId: chat.chatId,
        success: true,
        messageId: firstMessageId ?? undefined,
      });

      logger.info(
        { chatId: chat.chatId, chatTitle: chat.chatTitle, messageId: firstMessageId },
        '✅ Hisobot yuborildi'
      );
    } catch (err: any) {
      results.push({
        chatId: chat.chatId,
        success: false,
        error: err.message,
      });
      logger.error(
        { chatId: chat.chatId, chatTitle: chat.chatTitle, err },
        '❌ Chatga yuborilmadi'
      );
    }
  }

  // Birinchi muvaffaqiyatli yuborilgan chat'ning messageId'sini DB ga yozamiz
  const firstSuccess = results.find(r => r.success);
  await prisma.dailyReport.updateMany({
    where: { id: { in: reports.map(r => r.id) } },
    data: {
      sentToTelegram: results.some(r => r.success),
      telegramMessageId: firstSuccess?.messageId?.toString() ?? null,
      sentAt: new Date(),
    },
  });

  const successCount = results.filter(r => r.success).length;
  logger.info(
    { total: results.length, success: successCount, failed: results.length - successCount },
    '📊 Broadcast yakuni'
  );

  if (successCount === 0) {
    throw new TelegramSendError(
      'Hech qaysi chat ga yuborilmadi: ' +
        results.map(r => `${r.chatId}=${r.error}`).join(', ')
    );
  }
}

/**
 * Backward compat — kechagi kun
 */
export async function sendDailyReport(): Promise<void> {
  return sendReport(1);
}

/**
 * Xato bo'lganda barcha adminlarga (yoki default chatga) xabar yuborish.
 */
export async function sendErrorNotification(error: Error): Promise<void> {
  const admins = await adminService.listAdmins();
  const message =
    `🚨 <b>HISOBOTDA XATO</b>\n\n` +
    `<b>Vaqt:</b> ${new Date().toISOString()}\n` +
    `<b>Xato:</b>\n<code>${escapeHtml(error.message).slice(0, 1500)}</code>\n\n` +
    `<i>Loglarni tekshiring.</i>`;

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
      await bot.telegram.sendMessage(target, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err, target }, 'Adminga xato xabari yuborilmadi');
    }
  }
}

function chunkMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let current = '';
  const lines = text.split('\n');

  for (const line of lines) {
    if ((current + line + '\n').length > maxLen) {
      if (current) chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }

  if (current) chunks.push(current);
  return chunks;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
