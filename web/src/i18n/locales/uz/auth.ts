// Uzbek (Latin). Typography: ʻ (U+02BB) in oʻ / gʻ and ʼ (U+02BC) for the tutuq belgisi; no ASCII apostrophes in this file.
import type { DictShape } from "../../types";
import type { auth as en } from "../en/auth";

export const auth = {
  login: {
    title: "Xush kelibsiz",
    subtitle: "Ishni davom ettirish uchun tizimga kiring",
    submit: "Kirish",
    noAccount: "Yasada yangimisiz?",
    signupLink: "Hisob yaratish",
    success: "Xush kelibsiz, {name}!",
  },

  signup: {
    title: "Hisob yarating",
    subtitle: "AI bilan suhbatlashib ilova va saytlar yaratishni boshlang",
    submit: "Hisob yaratish",
    haveAccount: "Hisobingiz bormi?",
    loginLink: "Kirish",
    success: "Yasaga xush kelibsiz, {name}!",
    pendingPrompt: "Gʻoyangiz saqlab qoʻyildi. Roʻyxatdan oʻtishingiz bilan uni yaratishni boshlaymiz.",
    terms: "Foydalanish bepul. Bank kartasi kerak emas.",
  },

  fields: {
    name: "Ism",
    namePlaceholder: "Ismingiz",
    email: "Email",
    emailPlaceholder: "siz@example.com",
    password: "Parol",
    passwordPlaceholder: "Parolingiz",
    newPasswordPlaceholder: "Kamida {min} ta belgi",
    passwordHint: "Kamida {min} ta belgi",
    showPassword: "Parolni koʻrsatish",
    hidePassword: "Parolni yashirish",
  },

  validation: {
    nameRequired: "Ismingizni kiriting",
    nameTooLong: "Ism juda uzun (koʻpi bilan {max} ta belgi)",
    emailRequired: "Email manzilingizni kiriting",
    emailInvalid: "Toʻgʻri email manzil kiriting",
    passwordRequired: "Parolni kiriting",
    passwordTooShort: "Parol kamida {min} ta belgidan iborat boʻlishi kerak",
    passwordTooLong: "Parol juda uzun (koʻpi bilan {max} ta belgi)",
  },

  errors: {
    invalidCredentials: "Email yoki parol notoʻgʻri.",
    emailTaken: "Bu email bilan hisob allaqachon mavjud. Tizimga kirib koʻring.",
  },

  forgot: {
    link: "Parolni unutdingizmi?",
    title: "Parolni tiklash",
    note: "Yasa email xabar yubormaydi. Parolingizni tiklashni shu server administratoridan soʻrang. U quyidagi buyruqni ishga tushiradi:",
    after: "Administrator vaqtinchalik parol oladi. Shu parol bilan kiring va uni Sozlamalar boʻlimida oʻzgartiring.",
  },
} as const satisfies DictShape<typeof en>;
