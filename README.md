# 📊 Target Analytic Bot

Meta (Facebook Ads) avtomatik hisobot tizimi. Har kuni ertalab **08:00** da Telegram guruhga kechagi kun statistikasini yuboradi.

## 🎯 Imkoniyatlari

- **2 ta campaign** ni parallel analiz qiladi:
  - **Campaign 1** — 5 ta filial (har biri alohida adset)
  - **Campaign 2** — bitta umumiy lead form, leadlar filiallarga `field_data` orqali ajratiladi
- **Spend taqsimlash**: Campaign 2 da umumiy budjet leadlar soniga proporsional taqsimlanadi
- **Avtomatik token monitoring** — 14 kundan kam qolsa ogohlantirish
- **Retry logic + rate limiting** — Meta API limitlarni hurmat qiladi
- **Audit log** — barcha API call'lar DB ga saqlanadi

## 🛠 Texnologiyalar

- **Node.js 20+** + TypeScript
- **PostgreSQL 16** + Prisma ORM
- **Telegraf** (Telegram bot)
- **node-cron** (scheduler)
- **axios** + **bottleneck** (Meta API + rate limit)
- **pino** (structured logging)

## 📁 Folder Structure

```
src/
├── config/      # Env validation, constants
├── lib/         # Logger, prisma, retry, errors, date utils
├── meta/        # Meta API client, services, types
├── reports/     # Business logic (aggregation, campaigns)
├── telegram/    # Bot, formatter, sender
├── jobs/        # Cron scheduler, daily/token jobs
├── scripts/     # CLI scripts (manual run, token check)
└── index.ts     # Entry point
```

## 🚀 O'rnatish (Local)

### 1. Repodan klone qilish

```bash
git clone <repo>
cd target-analytic-bot
npm install
```

### 2. PostgreSQL ishga tushirish

```bash
docker run -d \
  --name target-pg \
  -p 5432:5432 \
  -e POSTGRES_USER=target_user \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=target_bot \
  postgres:16-alpine
```

### 3. Environment

```bash
cp .env.example .env
```

`.env` ni quyidagi qiymatlar bilan to'ldiring:
- `META_ACCESS_TOKEN` — Meta Business Manager dan System User token
- `TELEGRAM_BOT_TOKEN` — `@BotFather` dan olingan token
- `TELEGRAM_CHAT_ID` — guruh ID (manfiy, masalan `-1001234567890`)

### 4. Database migration

```bash
npm run db:generate
npm run db:migrate:dev
```

### 5. Ishga tushirish

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start
```

## 🔑 Meta Access Token (Production)

### Eng yaxshi yo'l — System User token

1. [business.facebook.com](https://business.facebook.com) → **Settings**
2. **Users** → **System Users** → **Add**
3. System user → **Add Assets** → Ad Account ni qo'shing
4. **Generate New Token**:
   - App: sizning app
   - Scopes: `ads_read`, `ads_management`, `leads_retrieval`, `business_management`
   - Duration: **Never expires** ✅
5. Tokenni `.env` ga yozing

> System User tokeni **never-expiring**. Production uchun shu tavsiya etiladi.

### Alternativa — Long-lived user token

1. Graph API Explorer'dan **short-lived token** oling
2. Quyidagi command bilan **60 kunlik** ga almashtiring:

```bash
curl -G \
  "https://graph.facebook.com/v21.0/oauth/access_token" \
  -d "grant_type=fb_exchange_token" \
  -d "client_id=APP_ID" \
  -d "client_secret=APP_SECRET" \
  -d "fb_exchange_token=SHORT_TOKEN"
```

## 📱 Telegram Bot Sozlash

### 1. Bot yaratish

1. `@BotFather` → `/newbot` → bot nomi va username
2. Token oling
3. `.env` ga `TELEGRAM_BOT_TOKEN` ga yozing

### 2. Guruh ID olish

1. Botni guruhga qo'shing va **admin** qiling
2. Guruhga `/start` deb yozing
3. `https://api.telegram.org/bot<TOKEN>/getUpdates` orqali chat ID oling (manfiy raqam)
4. `.env` da `TELEGRAM_CHAT_ID` ga yozing

## 🤖 Mavjud komandalar

| Komanda | Vazifa |
|---------|--------|
| `/start` | Bot info |
| `/status` | Bot va token holati |
| `/report` | Kechagi kun hisobotini darhol generatsiya qilish |
| `/last` | Oxirgi hisobotni qayta yuborish |

## 🔧 CLI Scriptlari

```bash
# Token holatini tekshirish
npm run token:check

# Hisobotni manual ishga tushirish
npm run report:run

# Prisma Studio
npm run db:studio
```

## 🐳 Docker Deployment

```bash
# .env da DB_PASSWORD ni qo'shing
echo "DB_PASSWORD=strong_password_here" >> .env

# Build + run
docker-compose up -d

# Loglarni ko'rish
docker-compose logs -f app

# To'xtatish
docker-compose down
```

## ☁️ Railway Deployment

1. Repo ni GitHub ga push qiling
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. **Add Service** → **PostgreSQL** (avtomatik `DATABASE_URL` qo'yiladi)
4. **Variables** → `.env` dagi qiymatlarni kiriting
5. Deploy avtomatik ishlaydi

## 📊 Cron Schedule

`.env` da `CRON_SCHEDULE` ni o'zgartiring:

| Expression | Vaqt |
|------------|------|
| `0 8 * * *` | Kuniga 08:00 (default) |
| `0 8,18 * * *` | Kuniga 2 marta (08:00, 18:00) |
| `*/30 * * * *` | Har 30 daqiqada |
| `0 8 * * 1-5` | Faqat ish kunlari 08:00 |

Timezone `TZ` env variable orqali — default `Asia/Tashkent`.

## 🔒 Security Best Practices

- ✅ `.env` git'ga commit qilinmaydi (`.gitignore` da)
- ✅ Production'da System User never-expiring token ishlatiladi
- ✅ Telegram bot faqat ruxsat berilgan chat'lardan javob beradi
- ✅ Docker container non-root user ostida ishlaydi
- ✅ Pino logger redact qiladi (token, password, etc.)
- ✅ Prisma — parameterized queries (SQL injection yo'q)

## 🐛 Debugging

```bash
# Detailed loglar
LOG_LEVEL=debug npm run dev

# Prisma queries ko'rish
DEBUG=prisma:query npm run dev

# API call audit log
npm run db:studio
# → ApiCallLog jadval
```

## 📝 Hisobot namunasi (Telegram)

```
📊 2026-05-12 | TARGET HISOBOTI
━━━━━━━━━━━━━━━━━━━━━━

🎯 1-TARGET (5 FILIAL)

🏢 Chilonzor
   ├ 💰 Spend: 1 200 000 so'm
   ├ 📩 Leads: 24
   ├ 💵 CPL: 50 000 so'm
   ├ 👁 Impressions: 45 230
   ├ 👥 Reach: 28 100
   ├ 📊 CPM: 26 530 so'm
   ├ 🔗 Link Clicks: 312
   └ 📈 CTR: 0.69%

🏢 Sergeli
   ...

━━━━━━━━━━━━━━━━━━━━━━

🎯 2-TARGET (Lead Form)
💡 Spend leadlar soniga proporsional taqsimlangan

🏢 Yunusobod
   ├ 📩 Leads: 15 (30.0%)
   ├ 💰 Spend: 600 000 so'm
   └ 💵 CPL: 40 000 so'm

━━━━━━━━━━━━━━━━━━━━━━

📈 UMUMIY NATIJA
💰 Spend: 5 800 000 so'm
📩 Leadlar: 145
💵 Umumiy CPL: 40 000 so'm
```

## 📄 Litsenziya

MIT
