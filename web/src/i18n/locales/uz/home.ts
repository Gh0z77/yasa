// Uzbek (Latin). Typography: ʻ (U+02BB) in oʻ / gʻ and ʼ (U+02BC) for the tutuq belgisi; no ASCII apostrophes in this file.
import type { DictShape } from "../../types";
import type { home as en } from "../en/home";

export const home = {
  greeting: {
    title: "{name}, bugun nima yaratamiz?",
    titleNoName: "Bugun nima yaratamiz?",
    subtitle: "Gʻoyangizni oddiy soʻzlar bilan yozing. Yasa uni bir necha daqiqada ishlaydigan ilova yoki saytga aylantiradi.",
  },

  prompt: {
    label: "Nima yaratmoqchi ekaningizni yozing",
    placeholder1: "Qahvaxonam uchun menyu va xaritasi bor landing sahifa yarating…",
    placeholder2: "Sanoq taymeri va javob formasi bor toʻy taklifnomasi saytini yarating…",
    placeholder3: "Oylik xarajatlarimni kuzatib boradigan boshqaruv panelini yarating…",
    placeholder4: "Oʻquv markazi uchun kurslar katalogi va yozilish formasini yarating…",
    placeholder5: "Telegram kanalim uchun “Obuna boʻlish” tugmasi bor landing yarating…",
    submit: "Yaratishni boshlash",
    creating: "Loyihangiz yaratilmoqda…",
    attach: "Rasm biriktirish",
    attachGuest: "Rasm biriktirish uchun roʻyxatdan oʻting",
    attachLimit: "Koʻpi bilan {max} ta rasm biriktirish mumkin",
    removeAttachment: "“{name}” rasmini olib tashlash",
    dropHint: "Biriktirish uchun rasmlarni shu yerga tashlang",
    uploading: "Yuklanmoqda…",
    uploadFailed: "“{name}” faylini yuklab boʻlmadi",
    onlyImages: "Faqat PNG, JPEG, WebP va GIF rasmlarini biriktirish mumkin",
    waitUploads: "Rasmlar yuklanib boʻlishini kuting",
    hint: "Yuborish uchun Enter, yangi qator uchun Shift + Enter",
    examplesLabel: "Yoki tayyor gʻoyadan boshlang",
  },

  examples: {
    wedding: {
      label: "Toʻy taklifnomasi sayti",
      prompt:
        "Nafis toʻy taklifnomasi saytini yarating: kelin va kuyovning ismlari, toʻy sanasi, xaritasi bilan toʻyxona manzili, toʻygacha qolgan vaqtni koʻrsatadigan sanoq taymeri, kun dasturi, fotogalereya hamda mehmonlar kelishini tasdiqlaydigan forma.",
    },
    teahouse: {
      label: "Choyxona menyusi",
      prompt:
        "Milliy choyxona uchun menyu saytini yarating: taomlar turkumlarga ajratilgan, rasmlari va soʻmdagi narxlari bilan, “Kun taomi” bloki, ish vaqti, manzil va joy band qilish uchun qoʻngʻiroq tugmasi.",
    },
    courses: {
      label: "Oʻquv markazi kurslari",
      prompt:
        "Oʻquv markazi uchun sayt yarating: kurslar katalogi (ingliz tili, IT, matematika) darajasi, dars jadvali va narxlari bilan, oʻqituvchilar haqida maʼlumot, oʻquvchilar fikrlari va bepul sinov darsiga yozilish formasi.",
    },
    telegram: {
      label: "Telegram kanal uchun landing",
      prompt:
        "Telegram kanal uchun landing sahifa yarating: diqqatni tortadigan sarlavha, obunachilar nimaga ega boʻlishi, bir nechta namuna post, obunachilar statistikasi, fikrlar va katta “Telegramda obuna boʻlish” tugmasi.",
    },
    portfolio: {
      label: "Shaxsiy portfolio",
      prompt:
        "Dizayner uchun shaxsiy portfolio yarating: qisqa tanishtiruv, batafsil sahifalari bor loyihalar toʻri, “Men haqimda” boʻlimi, koʻnikmalar roʻyxati va aloqa formasi.",
    },
    shop: {
      label: "Onlayn doʻkon",
      prompt:
        "Qoʻlda yasalgan kulolchilik buyumlari uchun kichik onlayn doʻkon yarating: filtrli mahsulotlar toʻri, mahsulot sahifasi, umumiy summani koʻrsatadigan savat va oddiy buyurtma formasi.",
    },
  },

  demo: {
    text: "Demo rejimi: javoblar oldindan yozilgan.",
    action: "Bepul AI kalitini ulash (2 daqiqa)",
  },

  pending: {
    creating: "Gʻoyangiz asosida loyiha yaratilmoqda…",
  },

  recent: {
    title: "Soʻnggi loyihalar",
    subtitle: "Toʻxtagan joyingizdan davom eting",
    emptyTitle: "Hozircha loyihalar yoʻq",
    emptyDescription: "Yuqorida birinchi gʻoyangizni yozing, loyiha shu yerda paydo boʻladi.",
    errorTitle: "Loyihalaringizni yuklab boʻlmadi",
  },

  communitySection: {
    title: "Hamjamiyatdan",
    subtitle: "Istalgan loyihani ochib, qanday yasalganini koʻring yoki remiks qilib oʻzingizniki qiling",
  },

  card: {
    menu: "Loyiha amallari",
    open: "Ochish",
    untitled: "Nomsiz loyiha",
    updated: "{time} yangilangan",
    renamed: "Loyiha nomi oʻzgartirildi",
    duplicated: "“{name}” loyihasidan nusxa olindi",
    deleted: "Loyiha oʻchirildi",
    deleteTitle: "“{name}” oʻchirilsinmi?",
    deleteDescription:
      "Loyiha, uning suhbati, versiyalari va nashr qilingan sayti butunlay oʻchiriladi. Bu amalni ortga qaytarib boʻlmaydi.",
  },

  rename: {
    title: "Loyiha nomini oʻzgartirish",
    description: "Oson taniladigan qisqa nom tanlang.",
    label: "Loyiha nomi",
    placeholder: "Mening loyiham",
    required: "Nomni kiriting",
    tooLong: "Nom juda uzun (koʻpi bilan {max} ta belgi)",
  },

  projects: {
    title: "Loyihalar",
    description: "Yasa yordamida yaratgan barcha loyihalaringiz.",
    new: "Yangi loyiha",
    searchPlaceholder: "Loyihalarni qidirish…",
    searchLabel: "Loyihalarni qidirish",
    sortLabel: "Saralash",
    sortUpdated: "Oxirgi yangilangan",
    sortCreated: "Yaratilgan sana",
    sortName: "Nomi",
    emptyTitle: "Hozircha loyihalar yoʻq",
    emptyDescription: "Birinchi loyihangizni yarating va AI bilan suhbatlashib ishni boshlang.",
    noResultsTitle: "Hech narsa topilmadi",
    noResultsDescription: "“{query}” soʻrovi boʻyicha loyiha topilmadi. Boshqa soʻz bilan qidirib koʻring.",
    clearSearch: "Qidiruvni tozalash",
    errorTitle: "Loyihalaringizni yuklab boʻlmadi",
  },

  community: {
    title: "Hamjamiyat",
    description: "Siz kabi odamlar yaratgan ilova va saytlar. Oching, ichini koʻring, remiks qiling.",
    searchPlaceholder: "Hamjamiyatdan qidirish…",
    searchLabel: "Hamjamiyatdan qidirish",
    sortLabel: "Saralash",
    sortRecent: "Eng yangi",
    sortPopular: "Ommabop",
    by: "Muallif: {name}",
    openApp: "Ilovani ochish",
    view: "Koʻrish",
    remix: "Remiks",
    remixHint: "Oʻz nusxangizni yarating va ishni davom ettiring",
    remixed: "Remiks tayyor. Bu nusxa endi sizniki",
    loginToRemix: "Loyihani remiks qilish uchun tizimga kiring",
    emptyTitle: "Hamjamiyat endigina shakllanmoqda",
    emptyDescription: "Loyihangizni nashr qilib, ommaviy qiling va bu yerda birinchi boʻling.",
    noResultsTitle: "Hech narsa topilmadi",
    noResultsDescription: "“{query}” soʻrovi boʻyicha ommaviy loyiha topilmadi.",
    clearSearch: "Qidiruvni tozalash",
    errorTitle: "Hamjamiyatni yuklab boʻlmadi",
    loadMore: "Yana yuklash",
  },
} as const satisfies DictShape<typeof en>;
