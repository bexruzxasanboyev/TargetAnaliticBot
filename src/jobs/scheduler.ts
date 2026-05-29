import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { runDailyReportJob } from './daily-report.job';
import { runTokenCheckJob } from './token-check.job';

let dailyTask: cron.ScheduledTask | null = null;
let tokenTask: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  if (!cron.validate(env.CRON_SCHEDULE)) {
    throw new Error(`Noto'g'ri CRON_SCHEDULE: ${env.CRON_SCHEDULE}`);
  }
  if (!cron.validate(env.TOKEN_CHECK_SCHEDULE)) {
    throw new Error(`Noto'g'ri TOKEN_CHECK_SCHEDULE: ${env.TOKEN_CHECK_SCHEDULE}`);
  }

  // 1. Asosiy daily report
  dailyTask = cron.schedule(
    env.CRON_SCHEDULE,
    async () => {
      logger.info({ schedule: env.CRON_SCHEDULE }, '⏰ Daily report cron triggered');
      try {
        await runDailyReportJob();
      } catch (err) {
        logger.error({ err }, 'Daily report job error');
      }
    },
    { timezone: env.TZ }
  );

  // 2. Token health check
  tokenTask = cron.schedule(
    env.TOKEN_CHECK_SCHEDULE,
    async () => {
      logger.info({ schedule: env.TOKEN_CHECK_SCHEDULE }, '⏰ Token check cron triggered');
      try {
        await runTokenCheckJob();
      } catch (err) {
        logger.error({ err }, 'Token check job error');
      }
    },
    { timezone: env.TZ }
  );

  logger.info(
    {
      dailySchedule: env.CRON_SCHEDULE,
      tokenSchedule: env.TOKEN_CHECK_SCHEDULE,
      tz: env.TZ,
    },
    '✅ Scheduler ishga tushdi'
  );
}

export function stopScheduler(): void {
  dailyTask?.stop();
  tokenTask?.stop();
  logger.info('🛑 Scheduler to\'xtatildi');
}
