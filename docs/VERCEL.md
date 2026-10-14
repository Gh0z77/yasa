# Yasa’ni Vercel’ga joylashtirish

Yasa odatda bitta serverda, diskdagi SQLite bilan ishlaydi (`docs/DEPLOY.md`). Vercel’da disk va doimiy jarayon yoʻq, shuning uchun u yerda uch narsa boshqacha:

| Nima | Oddiy server | Vercel |
| --- | --- | --- |
| Maʼlumotlar bazasi | SQLite fayli (`data/yasa.db`) | Postgres (`DATABASE_URL`, masalan Supabase) |
| Yaratilgan ilovalar manzili | har biri alohida subdomenda | bitta umumiy manzilda, yoʻl orqali (`/~nom/`) |
| Generatsiya | cheklanmagan | 270 soniyadan keyin toʻxtatilib, qurilgani saqlanadi |

Kod bir xil: server `DATABASE_URL` ni koʻrsa Postgres’ga, `VERCEL` ni koʻrsa serverless rejimga oʻtadi.

## 1. Maʼlumotlar bazasi (Supabase)

1. Supabase loyihasida **Project Settings → Database → Connection string → Session pooler** satrini oling (port `5432`, foydalanuvchi `postgres.<ref>`). Toʻgʻridan-toʻgʻri manzil (`db.<ref>.supabase.co`) faqat IPv6, Vercel’dan ishlamaydi.
2. Paroldagi maxsus belgilarni URL uchun kodlang (`$` → `%24`, `@` → `%40`, `#` → `%23`).
3. Yasa oʻz jadvallarini alohida `yasa` sxemasida yaratadi (birinchi soʻrovda, avtomatik) — `public` sxemadagi narsalarga tegmaydi.

Baza va funksiya bir hududda boʻlishi shart: har bir soʻrov bazaga bir necha marta murojaat qiladi. Supabase loyihasi Tokioda (`ap-northeast-1`) boʻlsa, Vercel’da **Settings → Functions → Function Region** ni **Tokyo (hnd1)** qiling.

## 2. Vercel loyihasi

1. Vercel’da **Add New → Project** → GitHub’dagi repozitoriyni tanlang. Framework: **Other** (sozlamalar `vercel.json` dan olinadi).
2. **Settings → Domains** ga ikkinchi manzil qoʻshing, masalan `yasa-sites.vercel.app`. Yaratilgan ilovalar shu manzilda ochiladi. U asosiy manzildan farq qilishi shart: yaratilgan kod Yasa’ning oʻz manzilida ishlamasligi kerak.
3. **Settings → Environment Variables** (Production):

| Oʻzgaruvchi | Qiymat |
| --- | --- |
| `DATABASE_URL` | 1-qadamdagi Session pooler satri |
| `APP_SECRET` | 32+ belgili tasodifiy satr. Keyin oʻzgartirmang: saqlangan kalitlar shu bilan shifrlanadi |
| `APP_URL` | asosiy manzil, masalan `https://yasa.vercel.app` |
| `SANDBOX_DOMAIN` | ikkinchi manzil, masalan `yasa-sites.vercel.app` |
| `SANDBOX_MODE` | `path` |
| `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `GEMINI_API_KEY` | AI kalitlari (kamida bittasi) |
| `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk kalitlari (boʻlmasa — ichki email + parol hisoblari) |

`APP_SECRET` uchun tasodifiy satr:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

4. **Deploy**. Build `npm run build:vercel` ni ishga tushiradi: veb-ilova (`vite build`) va butun server bitta funksiya sifatida `.vercel/output` ga yigʻiladi.
5. Clerk ishlatilsa, Clerk boshqaruv panelida Vercel manzilini ruxsat etilgan manzillarga qoʻshing (production instansiyasi oʻz domenini talab qiladi; `*.vercel.app` da development kalitlari ishlaydi).

## Cheklovlar

- **Generatsiya vaqti.** Vercel funksiyasi koʻpi bilan 300 soniya ishlaydi. Yasa 270-soniyada generatsiyani oʻzi toʻxtatadi va qurilganini versiya qilib saqlaydi; «davom et» deb yozilsa, qolgan joyidan davom etadi. Sekin bepul modellar katta loyihani bir urinishda tugata olmasligi mumkin. Chegara: `GENERATION_TIME_LIMIT_SECONDS`.
- **Bir nechta nusxa.** Vercel bir vaqtda bir nechta funksiya nusxasini ishlatishi mumkin. Generatsiya boshqa nusxada ketayotgan boʻlsa, sahifa uni bazadan har 1,5 soniyada oʻqib koʻrsatadi (harfma-harf emas, boʻlak-boʻlak); uni «Toʻxtatish» tugmasi bilan toʻxtatib boʻlmaydi.
- **Umumiy manzil.** Wildcard domen boʻlmagani uchun hamma yaratilgan ilovalar bitta manzilda (`SANDBOX_DOMAIN`) turadi:
  - ilova ochilganda manzildan `/~nom` qismi olib tashlanadi (routerlar ishlashi uchun), shuning uchun ulashishda manzil satridagini emas, Yasa koʻrsatgan toʻliq havolani bering;
  - ilovalar bir-birining `localStorage` maʼlumotini koʻra oladi — foydalanuvchilari tizimga kiradigan jiddiy ilovalar uchun bu xavfli;
  - ikkita turli loyihani ikki tabda ochsangiz, rasmlar adashishi mumkin (qaysi ilova ochiqligi cookie orqali eslab qolinadi).
  Oʻz domeningiz boʻlsa (nameserverlari Vercel’da), `*.sizning-domen` qoʻshib, `SANDBOX_MODE` ni olib tashlang — shunda har bir ilova alohida subdomenda turadi va bu cheklovlar yoʻqoladi.
- **Tezlik.** Har bir soʻrov bazaga tarmoq orqali boradi. Bir hududda bu 2–5 ms; boshqa hududda har bir sahifa sekundlab kechikadi.
- **Ulanishlar soni.** Har bir funksiya nusxasi bazaga bitta ulanish ushlab turadi; Supabase’ning bepul tarifida session pooler 15 ta ulanishgacha beradi.
- **Xotiradagi narsalar** (soʻrov cheklagichlari, model «sogʻligʻi» xotirasi, build keshi) har nusxada alohida va nusxa oʻchganda yoʻqoladi.
- **Foydalanuvchi domenlari** (loyihaga oʻz domenini ulash) Vercel’da avtomatik ishlamaydi: domenni Vercel loyihasiga qoʻlda qoʻshish kerak.

## Mahalliy tekshiruv

Postgres yoʻlini SQLite’siz, oʻrnatilgan Postgres (PGlite) bilan butun test toʻplamida tekshirish:

```bash
npm run test:pg
```

Vercel uchun yigʻilgan funksiyani kompyuterda ishga tushirish (haqiqiy `DATABASE_URL` bilan) — `scripts/build-vercel.mjs` chiqaradigan `.vercel/output/functions/index.func` papkasi oʻz `node_modules` ga ega va mustaqil ishlaydi.
