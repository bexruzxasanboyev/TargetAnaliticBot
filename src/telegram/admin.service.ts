import { prisma } from '../lib/prisma';

export class AdminService {
  /**
   * Admin sifatida ro'yxatdan o'tkazish (idempotent).
   */
  async registerAdmin(data: {
    telegramUserId: string;
    telegramUsername?: string;
    firstName?: string;
    lastName?: string;
  }) {
    return prisma.adminUser.upsert({
      where: { telegramUserId: data.telegramUserId },
      create: {
        telegramUserId: data.telegramUserId,
        telegramUsername: data.telegramUsername,
        firstName: data.firstName,
        lastName: data.lastName,
        isActive: true,
      },
      update: {
        telegramUsername: data.telegramUsername,
        firstName: data.firstName,
        lastName: data.lastName,
        isActive: true,
      },
    });
  }

  async isAdmin(telegramUserId: string): Promise<boolean> {
    const admin = await prisma.adminUser.findUnique({
      where: { telegramUserId },
    });
    return !!admin && admin.isActive;
  }

  async getAdminByTelegramId(telegramUserId: string) {
    return prisma.adminUser.findUnique({ where: { telegramUserId } });
  }

  async listAdmins() {
    return prisma.adminUser.findMany({
      where: { isActive: true },
      orderBy: { registeredAt: 'asc' },
    });
  }

  async revokeAdmin(telegramUserId: string) {
    return prisma.adminUser.update({
      where: { telegramUserId },
      data: { isActive: false },
    });
  }
}

export const adminService = new AdminService();
