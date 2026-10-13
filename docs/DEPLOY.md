# Yasa’ni serverga joylashtirish

Bitta server, Docker va Caddy (HTTPS). Sozlamalar `deploy/` papkasida.

> Bu sozlama hali haqiqiy serverda sinalmagan. Birinchi ishga tushirishda Caddy jurnalini kuzating (`docker compose logs -f caddy`).

## Nima kerak

| | Izoh |
|---|---|
| Server | Ubuntu 22.04+ VPS, kamida 2 GB xotira, ochiq 80 va 443 portlar, Docker oʻrnatilgan |
| Ilova domeni | Masalan `yasa.uz` — foydalanuvchilar quruvchini shu yerda ochadi |
| Sayt domeni | **Alohida** roʻyxatdan oʻtgan domen, masalan `yasa-apps.uz` — koʻrinishlar (`pv-….yasa-apps.uz`) va nashr qilingan saytlar (`doʻkon.yasa-apps.uz`) uchun |
| Cloudflare | Sayt domenining DNS’i Cloudflare’da boʻlsin: yulduzchali sertifikat DNS orqali olinadi |
| Clerk | Production instansiya (`pk_live_…`, `sk_live_…`), ilova domeni uchun sozlangan |
| AI kaliti | Kamida bitta: Gemini, NVIDIA NIM, Anthropic yoki OpenAI |

Sayt domeni ilova domenining subdomeni **boʻlmasligi** kerak: foydalanuvchilar yaratgan saytlar quruvchi bilan bir domenda tursa, uning cookie’lariga yaqinlashadi.

## 1. DNS

Ilova domeni (`yasa.uz`):

- `A  @  → server IP`

Sayt domeni (`yasa-apps.uz`, Cloudflare’da, **proksisiz** — kulrang bulut):

- `A  @  → server IP`
- `A  *  → server IP`

Clerk production instansiyasi soʻragan CNAME yozuvlarini ham ilova domeniga qoʻshing (Clerk paneli ularni koʻrsatadi).

## 2. Cloudflare tokeni

Cloudflare → My Profile → API Tokens → Create Token → «Edit zone DNS» andozasi, faqat sayt domeni uchun. Token `CLOUDFLARE_API_TOKEN` ga yoziladi.

## 3. Sozlamalar

```bash
git clone <repo> yasa && cd yasa/deploy
```

```bash
cp .env.example .env
```

`.env` ni toʻldiring. `APP_SECRET` uchun:

```bash
openssl rand -base64 48
```

`APP_SECRET` ni keyin oʻzgartirmang: saqlangan API kalitlari va tokenlar shu bilan shifrlangan.

## 4. Ishga tushirish

```bash
docker compose --env-file .env up -d --build
```

Tekshirish:

```bash
docker compose ps
```

```bash
curl -s https://yasa.uz/api/health
```

Javob `{"ok":true,…}` boʻlishi kerak. Soʻng brauzerda ilova domenini oching, roʻyxatdan oʻting, loyiha yarating va koʻrinish ochilishini tekshiring (bu yulduzchali sertifikat ishlayotganini koʻrsatadi).

## 5. Yangilash

```bash
git pull && docker compose --env-file .env up -d --build
```

Qayta ishga tushirish paytida ketayotgan generatsiyalar uziladi (foydalanuvchiga «uzildi» xabari chiqadi) — yangilashni tinch vaqtda qiling.

## 6. Zaxira nusxa

Hamma maʼlumot `yasa-data` jildida (SQLite bazasi va yuklangan fayllar):

```bash
docker run --rm -v deploy_yasa-data:/data -v "$PWD":/backup alpine tar czf /backup/yasa-data.tgz -C /data .
```

## Foydalanuvchilarning shaxsiy domenlari

Foydalanuvchi nashr oynasida domen qoʻshadi va DNS’da ikki yozuv yaratadi: egalikni tasdiqlovchi TXT hamda domenni serverga yoʻnaltiruvchi CNAME (yoki A). Tasdiqlangach, Caddy shu domen uchun sertifikatni birinchi soʻrovda oʻzi oladi. Tasdiqlanmagan domenlar uchun sertifikat soʻralmaydi (`/api/tls-check`).

## Cheklovlar

- Bitta server, bitta jarayon: generatsiya navbati xotirada, gorizontal kengaymaydi.
- SQLite: oʻrta yuklama uchun yetarli, juda koʻp foydalanuvchi uchun PostgreSQL’ga koʻchirish kerak boʻladi.
- Cloudflare’siz boshqa DNS provayder ishlatilsa, `Dockerfile.caddy` va `Caddyfile` dagi DNS modulini shunga almashtiring.
