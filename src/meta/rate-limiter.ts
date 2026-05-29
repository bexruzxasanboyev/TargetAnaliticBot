import Bottleneck from 'bottleneck';
import { META_RATE_LIMIT } from '../config/constants';

/**
 * Meta API uchun rate limiter.
 *
 * Limitlar:
 *  - 180 calls / hour (200 dan kam — buffer)
 *  - 5 concurrent
 *  - har request orasida 200ms minimum
 */
export const metaLimiter = new Bottleneck({
  reservoir: META_RATE_LIMIT.reservoir,
  reservoirRefreshAmount: META_RATE_LIMIT.reservoir,
  reservoirRefreshInterval: META_RATE_LIMIT.refreshIntervalMs,
  maxConcurrent: META_RATE_LIMIT.maxConcurrent,
  minTime: META_RATE_LIMIT.minTimeMs,
});

metaLimiter.on('depleted', () => {
  // Rate limit yaqinlashganda log qilamiz
  // eslint-disable-next-line no-console
  console.warn('[meta-limiter] reservoir tugadi — keyingi soatgacha kutish');
});
