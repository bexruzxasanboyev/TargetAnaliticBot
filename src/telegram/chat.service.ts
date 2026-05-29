import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export class ChatService {
  /**
   * Chat'ni hisobot ro'yxatiga qo'shish.
   */
  async addChat(data: {
    chatId: string;
    chatTitle?: string;
    chatType?: string;
    threadId?: string;
    addedByAdminId?: string;
  }) {
    return prisma.reportChat.upsert({
      where: { chatId: data.chatId },
      create: {
        chatId: data.chatId,
        chatTitle: data.chatTitle,
        chatType: data.chatType,
        threadId: data.threadId,
        addedByAdminId: data.addedByAdminId,
        isActive: true,
      },
      update: {
        chatTitle: data.chatTitle,
        chatType: data.chatType,
        threadId: data.threadId,
        isActive: true,
      },
    });
  }

  async removeChat(chatId: string) {
    return prisma.reportChat.update({
      where: { chatId },
      data: { isActive: false },
    });
  }

  async listActiveChats() {
    return prisma.reportChat.findMany({
      where: { isActive: true },
      include: { addedBy: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getChat(chatId: string) {
    return prisma.reportChat.findUnique({ where: { chatId } });
  }

  /**
   * .env dagi default TELEGRAM_CHAT_ID ni DB ga seed qiladi (faqat bo'sh bo'lsa).
   */
  async seedDefaultIfEmpty(): Promise<void> {
    if (!env.TELEGRAM_CHAT_ID) return;

    const count = await prisma.reportChat.count({ where: { isActive: true } });
    if (count > 0) return;

    await this.addChat({
      chatId: env.TELEGRAM_CHAT_ID,
      chatTitle: 'Default chat (from .env)',
      threadId: env.TELEGRAM_THREAD_ID,
    });
    logger.info({ chatId: env.TELEGRAM_CHAT_ID }, '✅ Default chat DB ga qo\'shildi');
  }
}

export const chatService = new ChatService();
