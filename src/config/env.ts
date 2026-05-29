import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Meta API
  META_ACCESS_TOKEN: z.string().min(50, 'Meta access token juda qisqa'),
  META_APP_ID: z.string().min(5),
  META_APP_SECRET: z.string().min(10),
  META_AD_ACCOUNT_ID: z.string().regex(/^act_\d+$/, 'Ad account ID "act_" bilan boshlanishi kerak'),
  META_API_VERSION: z.string().default('v21.0'),
  META_CAMPAIGN_1_ID: z.string().min(5),
  META_CAMPAIGN_2_ID: z.string().min(5),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  // Default chat ID — agar DB bo'sh bo'lsa, birinchi ishga tushganda DB ga qo'shiladi.
  // Admin /addchat orqali boshqa guruhlarni qo'sha oladi.
  TELEGRAM_CHAT_ID: z.string().optional().transform(v => v && v.length > 0 ? v : undefined),
  TELEGRAM_THREAD_ID: z.string().optional().transform(v => v && v.length > 0 ? v : undefined),
  TELEGRAM_ADMIN_ID: z.string().optional().transform(v => v && v.length > 0 ? v : undefined),
  // Admin parolini /admin komandasi orqali kiritadi
  ADMIN_PASSWORD: z.string().min(6, 'Admin parol kamida 6 belgi bo\'lishi kerak'),

  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  TZ: z.string().default('Asia/Tashkent'),
  CRON_SCHEDULE: z.string().default('0 8 * * *'),
  TOKEN_CHECK_SCHEDULE: z.string().default('0 9 * * *'),

  // Currency
  CURRENCY: z.string().default('UZS'),
  CURRENCY_LABEL: z.string().default("so'm"),

  // Monitoring
  SENTRY_DSN: z.string().optional(),

  // Google Sheets webhook (Apps Script Web App URL)
  // Bu eng oddiy yo'l — xech qanday Cloud Console kerak emas.
  SHEETS_WEBHOOK_URL: z.string().url().optional().or(z.literal('')).transform(v => v || undefined),
  SHEETS_WEBHOOK_SECRET: z.string().min(6).default('asosIT_sheets_secret_2026'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Environment variables noto\'g\'ri:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
