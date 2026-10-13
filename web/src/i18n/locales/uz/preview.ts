// Uzbek (Latin): use ʻ (U+02BB) and ʼ (U+02BC), never the ASCII apostrophe; strings use double quotes.
import type { DictShape } from "../../types";
import type { preview as en } from "../en/preview";

export const preview = {
  toolbar: {
    desktop: "Kompyuter",
    tablet: "Planshet",
    mobile: "Telefon",
    reload: "Koʻrinishni yangilash",
    openNewTab: "Yangi varaqda ochish",
    console: "Konsol",
    route: "Sahifa manzili",
    selecting: "Elementni bosing",
    frameTitle: "Ilova koʻrinishi",
  },
  loading: {
    title: "Koʻrinish yuklanmoqda…",
    slow: "Koʻrinish yuklanishi choʻzilmoqda",
    slowHint: "Birinchi yuklashda ilova paketlari olinadi, bu yarim daqiqagacha vaqt olishi mumkin.",
    openDirect: "Toʻgʻridan-toʻgʻri ochish",
  },
  firstRun: {
    title: "Yasa ilovangizni yaratmoqda",
    thinking: "Oʻylamoqda",
    writing: "Fayllar yozilmoqda",
    building: "Yigʻilmoqda",
    ready: "Tayyor",
    tipSelect: "Maslahat: nimani oʻzgartirmoqchi ekaningizni «Elementni tanlash» orqali koʻrsating.",
    tipChat: "Maslahat: yaratishdan oldin rejalashtirish uchun Suhbat rejimiga oʻting.",
    tipHistory: "Maslahat: har bir oʻzgarish versiya sifatida saqlanadi va uni tiklash mumkin.",
  },
  updating: "Yangilanmoqda…",
  errors: {
    build: "Ilova yigʻilmayapti",
    runtime: "Ilovada xatolik yuz berdi",
    resources: "Yuklanmagan resurslar: {count}",
    more: "yana +{count}",
    fixRequest: "Shu xatolarni tuzating.",
    dismiss: "Yopish",
  },
  console: {
    title: "Konsol",
    empty: "Hozircha yozuvlar yoʻq",
    clear: "Konsolni tozalash",
    all: "Hammasi",
    errors: "Xatolar",
    warnings: "Ogohlantirishlar",
    close: "Konsolni yashirish",
  },
} as const satisfies DictShape<typeof en>;
