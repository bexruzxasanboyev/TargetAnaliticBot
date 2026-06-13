/**
 * Loyiha bo'yicha umumiy konstantalar
 */

export const META_BASE_URL = 'https://graph.facebook.com';

// Meta API rate limit: app-level 200 calls / hour / user.
// Biz 180 ga qo'yamiz — buffer uchun.
export const META_RATE_LIMIT = {
  reservoir: 180,
  refreshIntervalMs: 60 * 60 * 1000, // 1 soat
  maxConcurrent: 5,
  minTimeMs: 200,
};

// Lead action turlarini ajratish uchun
export const LEAD_ACTION_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
];

// Lead form fielda filial nomi bo'lishi mumkin bo'lgan kalit so'zlar
export const BRANCH_FIELD_KEYWORDS = [
  'filial',
  'branch',
  'manzil',
  'address',
  'location',
  'qaysi_filial',
  'kerakli_filial',
  'sizning_filialingiz',
  'tanlang',
];

// Filial nomlari normalizatsiyasi (lowercase → canonical)
export const BRANCH_NORMALIZATION: Record<string, string> = {
  chilonzor: 'Chilonzor',
  sergeli: 'Sergeli',
  yunusobod: 'Yunusobod',
  yunusabad: 'Yunusobod',
  mirobod: 'Mirobod',
  shayxontohur: 'Shayxontohur',
  shaykhontohur: 'Shayxontohur',
  shaykhontokhur: 'Shayxontohur',
  yashnobod: 'Yashnobod',
  yakkasaroy: 'Yakkasaroy',
  olmazor: 'Olmazor',
  uchtepa: 'Uchtepa',
  bektemir: 'Bektemir',
  mirzo_ulugbek: "Mirzo Ulug'bek",
  'mirzo ulugbek': "Mirzo Ulug'bek",
  // Mudarris filiallari
  beruniy: 'Beruniy',
  qoyliq: "Qo'yliq",
  'qo\'yliq': "Qo'yliq",
  koyliq: "Qo'yliq",
  algoritm: 'Algoritm',
  pochemuchka: 'Pochemuchka',
  // Sinf segmentlari — adset nomlari har xil yozilgan bo'lsa ham bitta guruh
  '5-10-11': '5-11-sinflar',
  '5-11': '5-11-sinflar',
  '5-10': '5-11-sinflar',
  '1-4': '1-4-sinflar',
};

// Meta API muhim error code lari
export const META_ERROR_CODES = {
  RATE_LIMIT_APP: 4,
  TEMPORARY: 2,
  RATE_LIMIT_USER: 17,
  TOKEN_EXPIRED: 190,
  PERMISSION: 200,
  TOO_MANY_CALLS: 32,
  AD_ACCOUNT_RATE_LIMIT: 613,
} as const;

// Retry uchun (network + transient errors)
export const RETRYABLE_HTTP_CODES = [408, 429, 500, 502, 503, 504];

// Telegram message limit
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const TELEGRAM_SAFE_CHUNK_SIZE = 3800; // Buffer uchun
