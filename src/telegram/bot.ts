import { Telegraf, Context, Markup } from 'telegraf';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { adminService } from './admin.service';
import { chatService } from './chat.service';

export const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

/**
 * Adminligini tekshirish helper.
 */
async function requireAdmin(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id?.toString();
  if (!userId) {
    await ctx.reply('❌ Foydalanuvchi ID aniqlanmadi.');
    return false;
  }
  const isAdmin = await adminService.isAdmin(userId);
  if (!isAdmin) {
    await ctx.reply(
      '⛔ Bu komanda faqat adminlar uchun.\n\n' +
      'Admin bo\'lish uchun: <code>/admin &lt;parol&gt;</code>',
      { parse_mode: 'HTML' }
    );
    return false;
  }
  return true;
}

/**
 * Hisobotni qaytadan generatsiya qilib (Meta API'dan), barcha aktiv
 * guruhlarga yuborish. /report komandasi va "📤 Hisobot yuborish" tugmasi
 * shu funksiyani chaqiradi.
 */
async function generateAndSendReport(ctx: Context): Promise<void> {
  await ctx.reply(
    '⏳ <b>Kechagi kun hisoboti</b> Meta API\'dan tayyorlanmoqda...\n' +
    '<i>~30-60 sekund ketishi mumkin.</i>',
    { parse_mode: 'HTML' }
  );
  try {
    const { runAccountBackfill } = await import('../scripts/account-backfill');
    const { sendReport } = await import('./sender');
    const result = await runAccountBackfill(1);
    await sendReport(1);
    await ctx.reply(
      `✅ Hisobot barcha aktiv guruhlarga yuborildi!\n` +
      `💰 Spend: $${result.totalSpend.toFixed(2)}\n` +
      `📩 Leadlar: ${result.totalLeads}`
    );
  } catch (err: any) {
    logger.error({ err }, 'generateAndSendReport xatosi');
    await ctx.reply(`❌ Xato: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

/**
 * Boshqaruv menyusi (inline tugmalar) — admin only.
 */
function controlMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📤 Hisobotni yuborish', 'send_report')],
    [Markup.button.callback('🔄 Oxirgini qayta yuborish', 'resend_last')],
  ]);
}

// ===================================================================
// PUBLIC commands (hamma uchun)
// ===================================================================

bot.command('start', async ctx => {
  await ctx.reply(
    "🤖 <b>Target Analytics Bot</b>\n\n" +
    "📅 Har kuni 08:00 da kechagi kun hisobotini avtomatik yuboradi.\n\n" +
    "<b>Mavjud komandalar:</b>\n" +
    "/chatid — joriy chat ID ni ko'rsatish\n" +
    "/admin &lt;parol&gt; — admin sifatida ro'yxatdan o'tish\n" +
    "/help — barcha komandalar",
    { parse_mode: 'HTML' }
  );
});

bot.command('help', async ctx => {
  const userId = ctx.from?.id?.toString();
  const isAdmin = userId ? await adminService.isAdmin(userId) : false;

  let msg = "🤖 <b>Target Analytics Bot — Komandalar</b>\n\n";
  msg += "<b>Hamma uchun:</b>\n";
  msg += "/start — bot info\n";
  msg += "/chatid — joriy chat ID\n";
  msg += "/admin &lt;parol&gt; — admin sifatida ro'yxatdan o'tish\n";
  msg += "/help — bu yordam\n";

  if (isAdmin) {
    msg += "\n<b>Admin komandalari:</b>\n";
    msg += "/menu — <b>tugmali boshqaruv paneli</b>\n";
    msg += "/addchat — joriy guruhni hisobot ro'yxatiga qo'shish\n";
    msg += "/removechat — joriy guruhni ro'yxatdan o'chirish\n";
    msg += "/listchats — barcha guruhlar ro'yxati\n";
    msg += "/admins — adminlar ro'yxati\n";
    msg += "/stats — <b>bugungi (live) statistika</b> — barcha guruhlarga\n";
    msg += "/report — kechagi kun hisobotini darhol generatsiya qilish\n";
    msg += "/last — oxirgi hisobotni qayta yuborish\n";
    msg += "/backfill [kunlar] — Sheets'ga oxirgi N kun (default 30)\n";
    msg += "/sheets — Google Sheets webhook ulanishini tekshirish\n";
    msg += "/status — bot va token holati\n";
  }

  await ctx.reply(msg, { parse_mode: 'HTML' });
});

/**
 * /chatid — joriy chat ID ni ko'rsatish (hamma uchun)
 */
bot.command('chatid', async ctx => {
  const chat = ctx.chat;
  if (!chat) return;

  const threadId = (ctx.message as any)?.message_thread_id;

  let msg = "💬 <b>Joriy chat ma'lumotlari</b>\n\n";
  msg += `<b>Chat ID:</b> <code>${chat.id}</code>\n`;
  msg += `<b>Type:</b> ${chat.type}\n`;
  if ('title' in chat && chat.title) {
    msg += `<b>Title:</b> ${escapeHtml(chat.title)}\n`;
  }
  if (threadId) {
    msg += `<b>Thread ID:</b> <code>${threadId}</code>\n`;
  }
  msg += `\n<i>Bu chatga hisobot yuborilishi uchun admin /addchat komandasi bilan qo'shsin.</i>`;

  await ctx.reply(msg, { parse_mode: 'HTML' });
});

/**
 * /admin <parol> — admin sifatida ro'yxatdan o'tish
 */
bot.command('admin', async ctx => {
  const text = (ctx.message as any)?.text || '';
  const parts = text.split(/\s+/);
  const password = parts.slice(1).join(' ').trim();

  if (!password) {
    await ctx.reply(
      "🔐 Admin parolini kiriting:\n\n<code>/admin &lt;parol&gt;</code>",
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (password !== env.ADMIN_PASSWORD) {
    logger.warn(
      { userId: ctx.from?.id, username: ctx.from?.username },
      '⚠️ Noto\'g\'ri admin paroli kiritildi'
    );
    await ctx.reply('❌ Parol noto\'g\'ri.');
    return;
  }

  const userId = ctx.from?.id?.toString();
  if (!userId) {
    await ctx.reply('❌ Foydalanuvchi ID aniqlanmadi.');
    return;
  }

  const admin = await adminService.registerAdmin({
    telegramUserId: userId,
    telegramUsername: ctx.from?.username,
    firstName: ctx.from?.first_name,
    lastName: ctx.from?.last_name,
  });

  logger.info({ adminId: admin.id, userId }, '✅ Yangi admin ro\'yxatdan o\'tdi');

  await ctx.reply(
    `✅ <b>Admin sifatida ro'yxatdan o'tdingiz!</b>\n\n` +
    `Endi quyidagi komandalardan foydalanishingiz mumkin:\n` +
    `/menu — tugmali boshqaruv paneli\n` +
    `/addchat — guruh qo'shish\n` +
    `/listchats — guruhlar ro'yxati\n` +
    `/admins — adminlar ro'yxati\n` +
    `/report — manual hisobot\n` +
    `/help — barcha komandalar`,
    { parse_mode: 'HTML' }
  );
});

// ===================================================================
// ADMIN commands
// ===================================================================

/**
 * /addchat — joriy chatni hisobot ro'yxatiga qo'shish (admin only)
 */
bot.command('addchat', async ctx => {
  if (!(await requireAdmin(ctx))) return;

  const chat = ctx.chat;
  if (!chat) return;

  const userId = ctx.from?.id?.toString();
  const admin = userId ? await adminService.getAdminByTelegramId(userId) : null;

  const threadId = (ctx.message as any)?.message_thread_id?.toString();
  const chatTitle = 'title' in chat ? chat.title : `Private (${chat.id})`;

  await chatService.addChat({
    chatId: chat.id.toString(),
    chatTitle: chatTitle ?? undefined,
    chatType: chat.type,
    threadId,
    addedByAdminId: admin?.id,
  });

  logger.info({ chatId: chat.id, addedBy: admin?.id }, '✅ Yangi chat qo\'shildi');

  await ctx.reply(
    `✅ <b>Chat qo'shildi!</b>\n\n` +
    `<b>Chat ID:</b> <code>${chat.id}</code>\n` +
    `<b>Nomi:</b> ${escapeHtml(chatTitle ?? '-')}\n` +
    (threadId ? `<b>Thread:</b> <code>${threadId}</code>\n` : '') +
    `\nEndi har kuni 08:00 da bu guruhga hisobot yuboriladi.`,
    { parse_mode: 'HTML' }
  );
});

/**
 * /removechat — joriy chatni ro'yxatdan o'chirish (admin only)
 */
bot.command('removechat', async ctx => {
  if (!(await requireAdmin(ctx))) return;

  const chat = ctx.chat;
  if (!chat) return;

  const existing = await chatService.getChat(chat.id.toString());
  if (!existing || !existing.isActive) {
    await ctx.reply('⚠️ Bu chat ro\'yxatda yo\'q yoki allaqachon o\'chirilgan.');
    return;
  }

  await chatService.removeChat(chat.id.toString());
  logger.info({ chatId: chat.id }, '🗑 Chat ro\'yxatdan o\'chirildi');

  await ctx.reply(
    `🗑 <b>Chat ro'yxatdan o'chirildi.</b>\n\n` +
    `Endi bu guruhga hisobot yuborilmaydi.`,
    { parse_mode: 'HTML' }
  );
});

/**
 * /listchats — barcha guruhlar ro'yxati (admin only)
 */
bot.command('listchats', async ctx => {
  if (!(await requireAdmin(ctx))) return;

  const chats = await chatService.listActiveChats();

  if (chats.length === 0) {
    await ctx.reply('📭 Ro\'yxatda hech qanday chat yo\'q.\n\nGuruhda /addchat yozing.');
    return;
  }

  let msg = `📋 <b>Hisobot yuboriladigan guruhlar (${chats.length})</b>\n\n`;
  chats.forEach((c, i) => {
    msg += `${i + 1}. <b>${escapeHtml(c.chatTitle ?? 'No title')}</b>\n`;
    msg += `   ID: <code>${c.chatId}</code>\n`;
    msg += `   Type: ${c.chatType ?? '-'}\n`;
    if (c.threadId) msg += `   Thread: <code>${c.threadId}</code>\n`;
    if (c.addedBy?.telegramUsername) {
      msg += `   Added by: @${c.addedBy.telegramUsername}\n`;
    }
    msg += '\n';
  });

  await ctx.reply(msg, { parse_mode: 'HTML' });
});

/**
 * /admins — adminlar ro'yxati (admin only)
 */
bot.command('admins', async ctx => {
  if (!(await requireAdmin(ctx))) return;

  const admins = await adminService.listAdmins();

  let msg = `👥 <b>Adminlar (${admins.length})</b>\n\n`;
  admins.forEach((a, i) => {
    const name = [a.firstName, a.lastName].filter(Boolean).join(' ') || 'No name';
    const username = a.telegramUsername ? `@${a.telegramUsername}` : '-';
    msg += `${i + 1}. <b>${escapeHtml(name)}</b> (${username})\n`;
    msg += `   ID: <code>${a.telegramUserId}</code>\n`;
    msg += `   Ro'yxatdan: ${a.registeredAt.toISOString().slice(0, 10)}\n\n`;
  });

  await ctx.reply(msg, { parse_mode: 'HTML' });
});

/**
 * /status — bot va token holati (admin only)
 */
bot.command('status', async ctx => {
  if (!(await requireAdmin(ctx))) return;

  const { tokenService } = await import('../meta/token.service');
  const health = await tokenService.checkTokenHealth();
  const chats = await chatService.listActiveChats();
  const admins = await adminService.listAdmins();

  await ctx.reply(
    `🤖 <b>Bot holati</b>\n\n` +
    `🌐 Environment: <code>${env.NODE_ENV}</code>\n` +
    `⏰ Timezone: <code>${env.TZ}</code>\n` +
    `📅 Cron: <code>${env.CRON_SCHEDULE}</code>\n` +
    `👥 Adminlar: <b>${admins.length}</b>\n` +
    `💬 Aktiv chatlar: <b>${chats.length}</b>\n\n` +
    `🔑 <b>Meta Token:</b>\n${health.message}`,
    { parse_mode: 'HTML' }
  );
});

/**
 * /report — kechagi kun umumiy hisoboti (admin only) — strict 5 filial
 */
bot.command('report', async ctx => {
  if (!(await requireAdmin(ctx))) return;
  await generateAndSendReport(ctx);
});

/**
 * /menu — boshqaruv tugmalari (admin only)
 */
bot.command('menu', async ctx => {
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply(
    '🎛 <b>Boshqaruv paneli</b>\n\n' +
    '📤 <b>Hisobotni yuborish</b> — Meta API\'dan qaytadan olib, barcha aktiv guruhlarga yuboradi.\n' +
    '🔄 <b>Oxirgini qayta yuborish</b> — saqlangan oxirgi hisobotni qayta yuboradi (tezroq).',
    { parse_mode: 'HTML', ...controlMenu() }
  );
});

/**
 * "📤 Hisobotni yuborish" tugmasi
 */
bot.action('send_report', async ctx => {
  await ctx.answerCbQuery('⏳ Tayyorlanmoqda...');
  if (!(await requireAdmin(ctx))) return;
  await generateAndSendReport(ctx);
});

/**
 * "🔄 Oxirgini qayta yuborish" tugmasi
 */
bot.action('resend_last', async ctx => {
  await ctx.answerCbQuery('🔄 Yuborilmoqda...');
  if (!(await requireAdmin(ctx))) return;
  try {
    const { sendDailyReport } = await import('./sender');
    await sendDailyReport();
    await ctx.reply('✅ Oxirgi hisobot barcha aktiv guruhlarga qayta yuborildi!');
  } catch (err: any) {
    await ctx.reply(`❌ Xato: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
});

/**
 * /stats — kechagi kun umumiy hisoboti (alias /report) (admin only)
 */
bot.command('stats', async ctx => {
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply(
    '⏳ <b>Umumiy hisobot</b> Meta API\'dan olinmoqda...\n' +
    '<i>~30-60 sekund ketadi.</i>',
    { parse_mode: 'HTML' }
  );
  try {
    const { runAccountBackfill } = await import('../scripts/account-backfill');
    const { sendReport } = await import('./sender');
    const result = await runAccountBackfill(1);
    await sendReport(1);
    await ctx.reply(
      `✅ Yuborildi!\n` +
      `💰 Spend: $${result.totalSpend.toFixed(2)}\n` +
      `📩 Leadlar: ${result.totalLeads}\n` +
      `🏢 Filiallar: ${result.c1Days > 0 || result.c2Days > 0 ? 'OK' : 'data yo\'q'}`
    );
  } catch (err: any) {
    logger.error({ err }, '/stats xatosi');
    await ctx.reply(`❌ Xato: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
});

/**
 * /sheets — Google Sheets webhook ulanishini tekshirish (admin only)
 */
bot.command('sheets', async ctx => {
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply('⏳ Webhook tekshirilmoqda...');
  try {
    const { sheetsService } = await import('../google/sheets.service');
    const result = await sheetsService.ping();
    await ctx.reply(
      `📊 <b>Sheets Webhook</b>\n\n${result.message}`,
      { parse_mode: 'HTML' }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Xato: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
});

/**
 * /backfill [kunlar] — Google Sheets'ga oxirgi N kun ma'lumotini yuklash (admin only)
 */
bot.command('backfill', async ctx => {
  if (!(await requireAdmin(ctx))) return;
  const text = (ctx.message as any)?.text || '';
  const parts = text.split(/\s+/);
  let days = parseInt(parts[1] ?? '30', 10);
  if (isNaN(days) || days < 1) days = 30;
  if (days > 90) days = 90;

  await ctx.reply(
    `⏳ <b>Backfill</b>: oxirgi ${days} kun ma'lumoti olinmoqda va Google Sheets'ga yuklanmoqda.\n` +
    `<i>Bu jarayonga ~${Math.ceil(days * 5 / 60)} daqiqa ketishi mumkin.</i>\n` +
    `Yakunlanganda xabar yuboraman.`,
    { parse_mode: 'HTML' }
  );

  try {
    const { runBackfill } = await import('../scripts/backfill-sheets');
    const result = await runBackfill(days);

    let msg = `✅ <b>Backfill yakunlandi</b>\n\n`;
    msg += `📅 Jami: <b>${result.total}</b> kun\n`;
    msg += `✅ Muvaffaqiyatli: <b>${result.success}</b>\n`;
    msg += `❌ Xato: <b>${result.failed}</b>\n`;

    if (result.errors.length > 0) {
      msg += `\n<b>Xatolar (birinchi 3):</b>\n`;
      for (const e of result.errors.slice(0, 3)) {
        msg += `• daysAgo=${e.daysAgo}: <code>${escapeHtml(e.error.slice(0, 150))}</code>\n`;
      }
    }

    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err: any) {
    logger.error({ err }, '/backfill xatosi');
    await ctx.reply(`❌ Backfill xato: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
});

/**
 * /last — oxirgi hisobotni qayta yuborish (admin only)
 */
bot.command('last', async ctx => {
  if (!(await requireAdmin(ctx))) return;
  try {
    const { sendDailyReport } = await import('./sender');
    await sendDailyReport();
    await ctx.reply('✅ Yuborildi!');
  } catch (err: any) {
    await ctx.reply(`❌ Xato: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
});

// ===================================================================
// Error handling
// ===================================================================

bot.catch((err, ctx) => {
  logger.error({ err, update: ctx.update }, 'Telegraf error');
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
