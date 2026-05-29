import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { META_BASE_URL } from '../config/constants';
import { differenceInDays } from 'date-fns';

interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number; // seconds
}

interface DebugTokenResponse {
  data: {
    app_id: string;
    user_id?: string;
    is_valid: boolean;
    scopes?: string[];
    expires_at: number; // unix seconds, 0 = never expires
    issued_at?: number;
    type?: string;
  };
}

export class TokenService {
  /**
   * Short-lived → Long-lived token (60 kun)
   */
  async exchangeForLongLived(shortToken: string): Promise<LongLivedTokenResponse> {
    const url = `${META_BASE_URL}/${env.META_API_VERSION}/oauth/access_token`;
    const res = await axios.get<LongLivedTokenResponse>(url, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        fb_exchange_token: shortToken,
      },
    });
    return res.data;
  }

  /**
   * Token validatsiya va info olish
   */
  async debugToken(token: string = env.META_ACCESS_TOKEN): Promise<DebugTokenResponse['data']> {
    const appAccessToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
    const res = await axios.get<DebugTokenResponse>(
      `${META_BASE_URL}/${env.META_API_VERSION}/debug_token`,
      {
        params: {
          input_token: token,
          access_token: appAccessToken,
        },
      }
    );
    return res.data.data;
  }

  /**
   * Tokenni DB ga saqlash (record yaratish)
   */
  async storeToken(token: string, expiresAt: Date): Promise<void> {
    // Eski activelarni deaktivatsiya qilamiz
    await prisma.metaToken.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    await prisma.metaToken.create({
      data: {
        accessToken: token, // Production'da AES-256 bilan encrypt qiling
        tokenType: 'long_lived',
        expiresAt,
        isActive: true,
      },
    });
    logger.info({ expiresAt }, '✅ Token saqlandi');
  }

  /**
   * Token sog'lig'ini tekshirish — har kuni ishlaydi.
   * 14 kundan kam qolsa — ogohlantirish.
   */
  async checkTokenHealth(): Promise<{
    isValid: boolean;
    daysLeft: number | null;
    expiresAt: Date | null;
    message: string;
  }> {
    try {
      const info = await this.debugToken();

      if (!info.is_valid) {
        return {
          isValid: false,
          daysLeft: null,
          expiresAt: null,
          message: '❌ Token invalid! Yangi token olish kerak.',
        };
      }

      if (info.expires_at === 0) {
        return {
          isValid: true,
          daysLeft: null,
          expiresAt: null,
          message: '✅ Token never-expiring (system user)',
        };
      }

      const expiresAt = new Date(info.expires_at * 1000);
      const daysLeft = differenceInDays(expiresAt, new Date());

      let message = `✅ Token valid, ${daysLeft} kun qoldi`;
      if (daysLeft <= 0) {
        message = '❌ Token muddati tugagan!';
      } else if (daysLeft <= 7) {
        message = `🚨 Token ${daysLeft} kunda tugaydi — DARHOL yangilang!`;
      } else if (daysLeft <= 14) {
        message = `⚠️ Token ${daysLeft} kunda tugaydi — yangilashni rejalashtiring`;
      }

      return {
        isValid: info.is_valid,
        daysLeft,
        expiresAt,
        message,
      };
    } catch (err: any) {
      logger.error({ err }, 'Token health check xatosi');
      return {
        isValid: false,
        daysLeft: null,
        expiresAt: null,
        message: `❌ Token tekshirish xatosi: ${err.message}`,
      };
    }
  }
}

export const tokenService = new TokenService();
