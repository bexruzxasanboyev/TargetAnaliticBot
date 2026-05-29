import { format, subDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { env } from '../config/env';

export interface DayRange {
  date: Date;
  isoDate: string;
  sinceUnix: number;
  untilUnix: number;
  isToday: boolean;
}

/**
 * Timezone (Asia/Tashkent) bo'yicha kun oralig'ini hisoblash.
 * @param daysAgo - 0 = bugun, 1 = kecha (default), 2 = avvalgi kun, va h.k.
 */
export function getDayInTz(daysAgo: number = 1): DayRange {
  const nowLocal = toZonedTime(new Date(), env.TZ);
  const targetLocal = subDays(nowLocal, daysAgo);

  const isoDate = format(targetLocal, 'yyyy-MM-dd');

  const startOfDayLocal = new Date(
    targetLocal.getFullYear(),
    targetLocal.getMonth(),
    targetLocal.getDate(),
    0, 0, 0, 0
  );
  const endOfDayLocal = new Date(
    targetLocal.getFullYear(),
    targetLocal.getMonth(),
    targetLocal.getDate(),
    23, 59, 59, 999
  );

  const sinceUtc = fromZonedTime(startOfDayLocal, env.TZ);
  const untilUtc = fromZonedTime(endOfDayLocal, env.TZ);

  return {
    date: sinceUtc,
    isoDate,
    sinceUnix: Math.floor(sinceUtc.getTime() / 1000),
    untilUnix: Math.floor(untilUtc.getTime() / 1000),
    isToday: daysAgo === 0,
  };
}

/**
 * Backward-compat: kechagi kun
 */
export function getYesterdayInTz(): DayRange {
  return getDayInTz(1);
}

export function formatIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
