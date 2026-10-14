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

Baza va funksiya bir hududda boʻlishi shart: har bir soʻrov bazaga bir necha marta murojaat qiladi, boshqa qitʼadagi baza sahifalarni soniyalab sekinlashtiradi. `vercel.json` funksiyani **Tokyo (`hnd1`)** ga qoʻyadi — Supabase loyihangiz Tokioda (`ap-northeast-1`) boʻlgani uchun. Baza boshqa hududda boʻlsa, `vercel.json` dagi `regions` ni oʻsha hududga yaqiniga oʻzgartiring (masalan Frankfurt uchun `fra1`).

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
| `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET` | Yasa’ning Supabase OAuth ilovasi (pastda) — foydalanuvchilar Supabase’ni bir bosishda ulashi uchun |

`APP_SECRET` uchun tasodifiy satr:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

4. **Deploy**. Build `npm run build:vercel` ni ishga tushiradi: veb-ilova (`vite build`) va butun server bitta funksiya sifatida `.vercel/output` ga yigʻiladi.
5. Clerk ishlatilsa, Clerk boshqaruv panelida Vercel manzilini ruxsat etilgan manzillarga qoʻshing (production instansiyasi oʻz domenini talab qiladi; `*.vercel.app` da development kalitlari ishlaydi).

## Foydalanuvchilarning oʻz Supabase akkaunti

Yaratilgan ilovalarning bazasi foydalanuvchining oʻz Supabase akkauntida turadi. Foydalanuvchi hech qanday kalit yoki token kiritmaydi: **Supabase bilan ulash** tugmasini bosadi, Supabase sahifasida Yasa’ga ruxsat beradi va qaytib keladi.

Buning uchun sayt egasi Yasa’ni Supabase’da **bir marta** roʻyxatdan oʻtkazadi:

1. supabase.com → oʻz tashkilotingiz → **Settings → OAuth Apps → Add application**.
2. Nom: `Yasa`, sayt manzili: asosiy manzil (masalan `https://yasa.vercel.app`), **Redirect URL**: `https://yasa.vercel.app/api/supabase/oauth/callback` (asosiy manzil + `/api/supabase/oauth/callback`).
3. Ruxsatlar (scopes): Organizations — read, Projects — read va write, Database — write, Secrets — read (loyiha kalitlarini olish uchun). Bular boʻlmasa, Yasa loyiha yarata olmaydi yoki jadvallarni qoʻllay olmaydi.
4. Berilgan **Client ID** va **Client Secret** ni Vercel’da `SUPABASE_OAUTH_CLIENT_ID` va `SUPABASE_OAUTH_CLIENT_SECRET` ga yozing va qayta deploy qiling.

Keyin:

- Foydalanuvchi **Sozlamalar → Integratsiyalar** da yoki loyihaning Cloud oynasida **Supabase bilan ulash** ni bosadi.
- Ilovaga hisoblar yoki saqlanadigan maʼlumot kerak boʻlsa, AI `<yasa-backend />` yozadi: Yasa foydalanuvchi akkauntida yangi Supabase loyihasi ochadi (Frankfurt, `eu-central-1`), kalitlarni oʻrnatadi va AI yozgan migratsiyalarni bazaga oʻzi qoʻllaydi. SQL xato boʻlsa, xato AI’ga qaytariladi va u tuzatadi.
- Cloud oynasida mavjud Supabase loyihasini tanlash yoki yangisini yaratish ham mumkin.
- Ulanish tokeni bir soatlik; Yasa uni oʻzi yangilab turadi. Foydalanuvchi Supabase’da ruxsatni bekor qilsa, ulanish oʻchadi.

Supabase’ning bepul tarifi bir tashkilotda 2 ta faol loyihaga ruxsat beradi; limitga yetilsa, Yasa buni aytadi va ilova bazasiz (brauzerda saqlab) quriladi.

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
