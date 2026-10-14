# Yasa — AI bilan ilova quruvchi

**Yasa** — [lovable.dev](https://lovable.dev) uslubidagi AI ilova quruvchi. Foydalanuvchi chatda nima kerakligini
yozadi, AI esa haqiqiy React + TypeScript + Vite + Tailwind loyihasini yozadi; natija yonidagi jonli koʻrinishda
(preview) darhol koʻrinadi. Kodni tahrirlash, versiyalar tarixi, tiklash, ommaviy havolaga nashr qilish, remiks va
ZIP yuklab olish mavjud. Interfeys uch tilda: oʻzbek, rus, ingliz.

## Imkoniyatlar

- **Chat orqali yaratish** — oqimli javob, fayl oʻzgarishlari kartalari, AI “oʻylashi” xulosasi, takliflar
- **Jonli koʻrinish** — har bir loyiha alohida subdomenda (`pv-<token>.localhost:3000`), telefon/planshet rejimi, konsol
- **Avtomatik tuzatish** — build xatosi yoki qoʻllanmagan tahrir boʻlsa, AI oʻzi 2 martagacha tuzatadi
- **Elementni tanlash** — koʻrinishdagi elementni bosib, aynan shuni oʻzgartirishni soʻrash
- **Suhbat rejimi** — kodga tegmasdan reja tuzish, keyin “Shuni yaratish”
- **Kod muharriri** — fayllar daraxti, avtosaqlash, AI yozayotgan faylni jonli koʻrish
- **Versiyalar** — har oʻzgarish saqlanadi; farqni koʻrish, tiklash, Bekor qilish/Qaytarish
- **Nashr qilish** — `http://<nom>.localhost:3000` kabi ommaviy havola, Telegramda ulashish
- **Hamjamiyat va remiks** — ochiq loyihalarni koʻrish va nusxasini olish
- **Bir nechta AI provayder** — Anthropic Claude, Google Gemini, OpenAI-mos (OpenRouter, DeepSeek, Groq, Ollama) va
  kalitsiz **Demo rejimi**; har bir foydalanuvchi oʻz API kalitini ulashi mumkin (shifrlangan holda saqlanadi)
- **Xavfsizlik** — yaratilgan ilovalar boshqa origin’da ishlaydi, sessiya cookie’si ularga yuborilmaydi, CSRF himoyasi

## Tez boshlash

Talab: **Node.js 24+**.

```bash
npm install
```

```bash
npm run dev
```

Brauzerda <http://localhost:5173> ni oching (Chrome, Edge yoki Firefox). API `3000`-portda ishlaydi.

AI kalitisiz ham ishlaydi — **Demo rejimi** oldindan yozilgan javoblar bilan mahsulotni sinab koʻrish imkonini beradi.

### Zaxira provayder va avtomatik oʻtish

Bir nechta provayder kaliti berilgan boʻlsa (masalan `GEMINI_API_KEY` va `NVIDIA_API_KEY`), Yasa tanlangan model javob bera olmaganda ishni oʻzi keyingisiga oʻtkazadi:

- **Javob boshlanmasdan** limit tugagan, provayder band yoki jim boʻlsa — darhol keyingi modelga oʻtadi (chatda bu haqda bir qatorli xabar chiqadi).
- **Javob oʻrtasida** ulanish uzilsa yoki model faylni yozib tugatmay toʻxtab qolsa — yozib boʻlingan fayllar saqlanadi va ish qolgan joyidan (boshqa model boʻlsa, oʻshanda) davom etadi (3 martagacha).
- **Model oʻz xatosini tuzata olmasa** — ikki urinishdan keyin ham build oʻtmasa, tuzatishni navbatdagi model oladi.
- **Xotira.** Limiti tugagan yoki javob bermagan model bir muddat (limit — 10 daqiqa, band — 3 daqiqa, tarmoq — 2 daqiqa, kalit xato — 30 daqiqa) chetlab oʻtiladi: keyingi soʻrovlar unga vaqt sarflamay, toʻgʻridan-toʻgʻri ishlaydigan modeldan boshlanadi. Zaxirasi boʻlgan model birinchi javobni 25 soniyada bermasa ham oʻtib ketiladi.

- **Buzilgan tuzatish qaytariladi.** Tuzatish urinishlari ishlab turgan buildni buzib qoʻysa, loyiha shu javob ichidagi oxirgi ishlaydigan holatga qaytariladi — foydalanuvchi buzilgan emas, ishlaydigan ilovani oladi.

Oʻtish tartibi: avval shu provayderning boshqa modellari, keyin Anthropic → OpenRouter (faqat bepul modellar) → NVIDIA NIM → Gemini → OpenAI (kaliti borlari). NVIDIA NIM kaliti bepul olinadi: <https://build.nvidia.com>.

### Bepul OpenRouter modellari

`OPENROUTER_API_KEY` (<https://openrouter.ai>) berilgan va pullik Anthropic kaliti boʻlmasa, standart model — OpenRouter’ning bepul modeli. Haqiqiy loyiha qurishda oʻlchangan tartib (bir xil soʻrov: grafik + jadval + forma):

| Model | Natija |
| --- | --- |
| `nvidia/nemotron-3-super-120b-a12b:free` (standart) | ~75 s, barqaror; birinchi javob 1 soniyadan tez |
| `cohere/north-mini-code:free` | ~270 s, ehtiyotkor |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | ~480 s, eng katta |

Biri javob bermasa yoki limitga tushsa, navbatdagisiga oʻtiladi; pullik model hech qachon oʻz-oʻzidan tanlanmaydi. Bepul modellar kuchsizroq: ular koʻproq xato qiladi (yuqoridagi tekshiruvlar aynan shuning uchun) va OpenRouter ularga kunlik hamda daqiqalik limit qoʻyadi. Boshqa bepul modellar sinovda yaroqsiz chiqdi: `thinkingmachines/inkling*` faqat maxsus agent ilovalariga ochiq (403), `poolside/laguna-*` va `google/gemma-4-*` katta soʻrovda limitga tushadi. Boshqa modelni standart qilish uchun `.env` ga `DEFAULT_MODEL=openrouter:<model>` yozing.

### Kutubxonalar va sifat nazorati

AI hamma narsani noldan yozmaydi: grafik uchun recharts, jadval uchun @tanstack/react-table, forma uchun react-hook-form + zod, sana uchun date-fns, animatsiya uchun motion va hokazo — tayyor kutubxonalardan foydalanadi. Har bir javobdan keyin server natijani oʻzi tekshiradi va kuchsiz model yoʻl qoʻyadigan xatolarni foydalanuvchiga yetkazmaydi:

- kod import qilgan, lekin `package.json`da yoʻq paketlar avtomatik qoʻshiladi (toʻgʻri major versiya bilan); oʻylab topilgan minor versiya (`^8.22.0`) `^8` ga keltiriladi;
- kutubxonadan mavjud boʻlmagan nom import qilinsa (masalan `useState`ni `react-hook-form`dan), build xatosi sifatida ushlanadi va tuzatiladi;
- yozilgan-u hech qayerda ishlatilmagan ekran/komponent boʻlsa (build «oʻtgan», lekin sahifa boʻsh) yoki javob birinchi fayllardan keyin toʻxtab qolgan boʻlsa, AI ishni tugatishga va ularni ulashga qaytariladi;
- chatga chiqib qolgan begona teglar (`</yasa-assistant>` kabi) olib tashlanadi;
- fayl `</file>` kabi notoʻgʻri teg bilan yopilgan boʻlsa ham toʻgʻri saqlanadi;
- Supabase migratsiyasidagi Postgres’da yoʻq `create policy if not exists` ishlaydigan shaklga oʻgiriladi.

### GitHub bilan sinxronlash

Ish maydonidagi **GitHubga yuborish** tugmasi loyiha kodini foydalanuvchining oʻz repozitoriysiga yuboradi. Foydalanuvchi GitHub’da fine-grained token yaratadi (Contents: oʻqish va yozish; yangi repozitoriy yaratish uchun Administration: oʻqish va yozish) va uni bir marta ulaydi — token bazada shifrlangan holda saqlanadi.

- Yangi nom berilsa, yopiq repozitoriy yaratiladi va kod asosiy tarmoqqa tushadi.
- Mavjud repozitoriy nomi berilsa, undagi fayllarga tegilmaydi: kod alohida `yasa` tarmogʻiga yuboriladi.
- Har bir yuborish — loyihaning joriy holatini aks ettiruvchi bitta commit.

### AI savollari va rasm generatsiyasi

- **Savollar.** Yangi loyihaning birinchi soʻrovida AI qurishdan oldin 3–4 ta savol beradi (uslub, ranglar palitrasi, boʻlimlar). Javoblar tugmalar bilan tanlanadi; «Oʻtkazib yuborish» ham bor.
- **Rasmlar.** AI loyihaga mos rasmlarni oʻzi yaratadi (`<yasa-image …/>`): rasm serverda generatsiya qilinib, loyihaning `public/images/` papkasiga saqlanadi va nashr qilingan saytda ham ishlaydi. Bir javobda 6 tagacha rasm.
- **Provayderlar** (`IMAGE_PROVIDER`): Gemini rasm modeli (kalitda rasm limiti boʻlsa) → NVIDIA NIM’dagi FLUX (bepul NIM kaliti bilan ishlaydi) → kalitsiz ochiq xizmat (juda sekin, zaxira).

### Sigʻim

Bitta server bir vaqtda `MAX_CONCURRENT_GENERATIONS` (standart 32) ta generatsiyani bajaradi; foydalanuvchi boshiga `MAX_GENERATIONS_PER_USER` (standart 2). Oddiy noutbukda oʻlchangan: nashr qilingan sahifalar ~5000 soʻrov/s, rasm fayllari ~4000 soʻrov/s, API ~18000 soʻrov/s. Amalda chegara serverda emas, AI provayderining limitlarida. Bir nechta serverga yoyish uchun SQLite’ni PostgreSQL’ga, xotiradagi navbatni tashqi navbatga koʻchirish kerak boʻladi (hali qilinmagan).

### Backend: Supabase

Ish maydonidagi **Backend (Supabase)** tugmasi loyihaga haqiqiy backend ulaydi: hisoblar, maʼlumotlar bazasi, fayl saqlash.

1. Supabase’da loyiha oching va **Project Settings → API** boʻlimidan loyiha URL manzili hamda ochiq (anon) kalitni oling.
2. Ularni Yasa’dagi oynaga kiriting. Ixtiyoriy (ikkalasidan biri yetadi) — shunda Yasa migratsiyalarni oʻzi bajaradi va Cloud boʻlimida jadvallar, foydalanuvchilar va saqlash chelaklari koʻrinadi:
   - Supabase kirish tokeni (`sbp_…`), yoki
   - maʼlumotlar bazasiga ulanish satri (**Project Settings → Database → Connection string → URI**, parol bilan). Toʻgʻridan-toʻgʻri manzil (`db.<ref>.supabase.co`) faqat IPv6 boʻlgani uchun yetib boʻlmasa, Yasa oʻzi loyiha hududidagi IPv4 poolerni topadi. Satr faqat shu loyihaning Supabase manziliga tegishli boʻlsa qabul qilinadi va shifrlangan holda saqlanadi.
3. Ulangach, loyihada `src/integrations/supabase/client.ts` paydo boʻladi va AI shu mijoz ustida quradi. Jadval, siyosat va saqlash joylari uchun SQL’ni `supabase/migrations/` ichiga yozadi.
4. Kutayotgan migratsiyalar oynada koʻrinadi: token boʻlsa — bir tugma bilan qoʻllanadi, boʻlmasa — SQL’ni Supabase SQL muharririga nusxalab, «Bajarildi» deb belgilaysiz.

Ochiq kalit brauzer uchun moʻljallangan; maxfiylikni har bir jadvaldagi RLS siyosatlari taʼminlaydi (AI ularni yozishga majbur). `service_role` kaliti hech qachon loyiha kodiga tushmasligi kerak.

### Jamoa boʻlib ishlash

**Ulashish** oynasida loyihaga odamlarni email orqali taklif qilish mumkin. **Muharrir** AI bilan ishlaydi va fayllarni oʻzgartiradi, **kuzatuvchi** faqat koʻradi. Oʻchirish, nashr qilish, sozlamalar, GitHub va Supabase ulanishi egada qoladi. Taklif email manzilga bogʻlanadi: odam shu (tasdiqlangan) email bilan kirgach, loyiha uning «Men bilan ulashilgan» roʻyxatida chiqadi. Bir vaqtda tahrirlash jonli sinxronlanmaydi — oʻzgarishlarni koʻrish uchun sahifa yangilanadi.

### Shaxsiy domen

Nashr qilingan loyihaga **Nashr qilish** oynasida oʻz domeningizni ulash mumkin: domen qoʻshiladi, DNS’da TXT (egalikni tasdiqlash) va CNAME (serverga yoʻnaltirish) yozuvlari yaratiladi, soʻng «Tekshirish» bosiladi. HTTPS sertifikati uchun [docs/DEPLOY.md](docs/DEPLOY.md) dagi Caddy sozlamasi kerak.

### Hisoblar: Clerk (ixtiyoriy)

Yasa ikki xil ishlaydi:

- **Clerk bilan** — `VITE_CLERK_PUBLISHABLE_KEY` va `CLERK_SECRET_KEY` berilgan boʻlsa, roʻyxatdan oʻtish va kirishni Clerk bajaradi (email, Google va h.k.). Server har bir soʻrovdagi Clerk tokenini tekshiradi va foydalanuvchini mahalliy bazadagi hisobga bogʻlaydi; loyihalar, kalitlar va limitlar oʻsha hisobda qoladi.
- **Clerk’siz** — kalitlar boʻlmasa, ichki email + parol hisoblari ishlaydi (testlar ham shu rejimda yuradi).

Kalitlarni olish:

```bash
npm install -g clerk
```

```bash
clerk auth login
```

```bash
clerk init --app <app_id>
```

Oxirgi buyruq kalitlarni `.env.local` fayliga yozadi (fayl git’ga tushmaydi). Clerk yoqilganidan keyin avvalgi email + parol hisobi egasi Clerk’da **xuddi shu, tasdiqlangan** email bilan kirsa, eski hisobi va loyihalari oʻziga bogʻlanadi.

Production uchun Clerk’da production instansiya oching, `pk_live_…` / `sk_live_…` kalitlarini bering va `APP_URL` ni toʻgʻri koʻrsating (token faqat shu manzildan qabul qilinadi). Veb qism build paytida `VITE_CLERK_PUBLISHABLE_KEY` ni oʻqiydi.

### AI kalitini ulash

Eng oson yoʻl — bepul **Google Gemini** kaliti (karta talab qilinmaydi):

1. <https://aistudio.google.com/apikey> sahifasida kalit yarating.
2. Yasa’da **Sozlamalar → AI va API kalitlari** boʻlimiga kalitni qoʻying (yoki `.env` fayliga yozing).

Server darajasida kalit berish uchun `.env.example` faylidan nusxa oling:

```bash
copy .env.example .env
```

| Oʻzgaruvchi | Tavsif |
|---|---|
| `GEMINI_API_KEY` | Google Gemini (standart model — Gemini Flash, bepul kalitlarda ishlaydi) |
| `ANTHROPIC_API_KEY` | Claude modellari (standart — `claude-opus-5`) |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | OpenAI-mos provayder |
| `DEFAULT_MODEL` | Masalan `gemini:gemini-flash-latest` |
| `DAILY_MESSAGE_LIMIT` | Server kaliti bilan kunlik xabarlar limiti (standart 100, `0` — cheksiz) |
| `ENABLE_MOCK_PROVIDER` | Demo rejimini yoqish/oʻchirish |

Barcha sozlamalar roʻyxati: [.env.example](.env.example).

## Buyruqlar

| Buyruq | Vazifa |
|---|---|
| `npm run dev` | Ishlab chiqish rejimi (API + Vite) |
| `npm run build` | Production build (`dist/web`, `dist/server`) |
| `npm start` | Production serverni ishga tushirish (bitta port — 3000) |
| `npm test` | Testlar (Vitest) |
| `npm run typecheck` | TypeScript tekshiruvi |
| `npm run admin -- reset-password <email>` | Foydalanuvchi parolini tiklash (vaqtinchalik parol chiqaradi) |
| `npm run admin -- list-users` | Foydalanuvchilar roʻyxati |
| `npm run gen:template` | Boshlangʻich loyiha shablonini qayta generatsiya qilish |
| `npm run check:images` | AI ishlatadigan rasmlar katalogini tekshirish |

## Koʻrinish (preview) qanday ishlaydi

AI yozgan fayllar ma’lumotlar bazasida saqlanadi. Server ularni **esbuild** bilan yigʻadi, Tailwind CSS’ni serverda
kompilyatsiya qiladi, npm paketlarni esa import map orqali `esm.sh` dan oladi. Natija alohida xostda beriladi:

- qoralama: `http://pv-<token>.localhost:3000`
- nashr qilingan ilova: `http://<nom>.localhost:3000`

`*.localhost` manzillari Chrome, Edge va Firefox’da hech qanday sozlashsiz ishlaydi. Safari yoki telefonda sinash uchun
`.env` ga `SANDBOX_DOMAIN=lvh.me:3000` (yoki `<LAN-IP>.nip.io:3000`) yozing.

Birinchi ochilishda paketlar CDN’dan yuklangani uchun koʻrinish 10–30 soniya kechikishi mumkin.

## Production’ga joylashtirish

Toʻliq qoʻllanma (Docker + Caddy, domenlar, sertifikatlar): [docs/DEPLOY.md](docs/DEPLOY.md).

**Vercel.** Disksiz (serverless) joylashtirish ham mumkin: maʼlumotlar Postgres’da (`DATABASE_URL`, masalan Supabase) turadi, yaratilgan ilovalar bitta umumiy manzilda ochiladi. Qadamlar va cheklovlar: [docs/VERCEL.md](docs/VERCEL.md).

```bash
npm run build
```

```bash
npm start
```

Tekshiruv roʻyxati:

- `APP_URL=https://yasa.example.com` — quruvchining manzili.
- `SANDBOX_DOMAIN=yasa-apps.com` — yaratilgan ilovalar uchun **alohida domen** (quruvchi domenidan farqli boʻlishi shart),
  `SANDBOX_PROTOCOL=https`.
- DNS: `*.yasa-apps.com` uchun wildcard yozuv; TLS: wildcard sertifikat (DNS-01 orqali).
- Reverse proxy `Host` sarlavhasini oʻzgartirmasligi, `text/event-stream` javoblarini buferlamasligi va kamida 6 MB
  soʻrov tanasiga ruxsat berishi kerak. Proxy ortida `TRUST_PROXY=true`.
- `DATA_DIR` doimiy diskda boʻlsin (`yasa.db` va `secret.key`). `secret.key` yoʻqolsa, saqlangan API kalitlarini
  ochib boʻlmaydi — `APP_SECRET` ni oʻzingiz bering yoki faylni zaxiralang.
- `ENABLE_MOCK_PROVIDER=false`, kerak boʻlsa `SIGNUPS_ENABLED=false`.

Caddy uchun namuna:

```caddyfile
yasa.example.com {
    reverse_proxy localhost:3000 {
        flush_interval -1
    }
}

*.yasa-apps.com {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }
    reverse_proxy localhost:3000
}
```

### Docker

```bash
docker build -t yasa .
```

Clerk bilan (publishable kalit build paytida kerak):

```bash
docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... -t yasa .
```

```bash
docker run -p 3000:3000 -v yasa-data:/app/data -e GEMINI_API_KEY=... yasa
```

## Loyiha tuzilishi

```
shared/     server va web uchun umumiy tiplar, konstantalar, yordamchilar
server/     Hono API, SQLite (node:sqlite), AI dvigateli, preview yigʻuvchi
  ai/       provayderlar, tizim prompti, oqimli parser, agent sikli, ishlar reestri
  preview/  esbuild + Tailwind yigʻish, import map, sandbox xost marshrutizatori, nashr
  template/ har bir yangi loyiha boshlanadigan shablon (Vite + React + Tailwind)
web/        React 19 + Vite interfeysi (chat, koʻrinish, kod, tarix, sozlamalar)
tests/      Vitest testlari
docs/       SPEC.md — toʻliq texnik spetsifikatsiya
```

## Hali yoʻq (yoʻl xaritasi)

Toʻlov tizimi va tariflar; bir vaqtda jonli hamkorlikda tahrirlash; Supabase’ga OAuth orqali (kalit kiritmasdan) ulanish;
GitHub’dan loyihaga qayta import; bir nechta serverda ishlash (hozir bitta jarayon va SQLite).
