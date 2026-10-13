// Clerk's screens in the app's three languages. Clerk ships English and Russian; Uzbek covers the sign-in and
// sign-up screens here and falls back to English elsewhere.
import { enUS, ruRU } from '@clerk/localizations';
import type { Locale } from '@shared/types';
import { APP_NAME } from '@shared/constants';

type Localization = typeof enUS;

const en: Localization = {
  ...enUS,
  signIn: { ...enUS.signIn, start: { ...enUS.signIn?.start, title: `Sign in to ${APP_NAME}` } },
  signUp: { ...enUS.signUp, start: { ...enUS.signUp?.start, title: 'Create your account', subtitle: `Start building with ${APP_NAME}` } },
};

const ru: Localization = {
  ...ruRU,
  signIn: { ...ruRU.signIn, start: { ...ruRU.signIn?.start, title: `Вход в ${APP_NAME}`, subtitle: 'С возвращением! Войдите, чтобы продолжить' } },
  signUp: { ...ruRU.signUp, start: { ...ruRU.signUp?.start, title: 'Создание аккаунта', subtitle: `Начните создавать в ${APP_NAME}` } },
};

const uz: Localization = {
  ...enUS,
  dividerText: 'yoki',
  formButtonPrimary: 'Davom etish',
  socialButtonsBlockButton: '{{provider|titleize}} orqali davom etish',
  formFieldLabel__emailAddress: 'Email manzil',
  formFieldLabel__password: 'Parol',
  formFieldLabel__firstName: 'Ism',
  formFieldLabel__lastName: 'Familiya',
  formFieldLabel__username: 'Foydalanuvchi nomi',
  formFieldInputPlaceholder__emailAddress: 'Email manzilingizni kiriting',
  formFieldInputPlaceholder__password: 'Parolingizni kiriting',
  formFieldInputPlaceholder__signUpPassword: 'Parol oʻylab toping',
  formFieldInputPlaceholder__firstName: 'Ism',
  formFieldInputPlaceholder__lastName: 'Familiya',
  signInEnterPasswordTitle: 'Parolingizni kiriting',
  formFieldAction__forgotPassword: 'Parolni unutdingizmi?',
  backButton: 'Orqaga',
  signIn: {
    ...enUS.signIn,
    start: {
      ...enUS.signIn?.start,
      title: `${APP_NAME}ga kirish`,
      subtitle: 'Xush kelibsiz! Davom etish uchun kiring',
      actionText: 'Hisobingiz yoʻqmi?',
      actionLink: 'Roʻyxatdan oʻtish',
    },
    password: {
      ...enUS.signIn?.password,
      title: 'Parolingizni kiriting',
      subtitle: 'Hisobingiz bilan bogʻlangan parolni kiriting',
      actionLink: 'Boshqa usuldan foydalanish',
    },
  },
  signUp: {
    ...enUS.signUp,
    start: {
      ...enUS.signUp?.start,
      title: 'Hisob yaratish',
      subtitle: `${APP_NAME}da birinchi loyihangizni boshlang`,
      actionText: 'Hisobingiz bormi?',
      actionLink: 'Kirish',
    },
    emailCode: {
      ...enUS.signUp?.emailCode,
      title: 'Emailingizni tasdiqlang',
      subtitle: 'Emailingizga yuborilgan kodni kiriting',
      formTitle: 'Tasdiqlash kodi',
      resendButton: 'Kod kelmadimi? Qayta yuborish',
    },
  },
  userButton: {
    ...enUS.userButton,
    action__manageAccount: 'Hisobni boshqarish',
    action__signOut: 'Chiqish',
  },
};

const BY_LOCALE: Record<Locale, Localization> = { en, ru, uz };

export function clerkLocalization(locale: Locale): Localization {
  return BY_LOCALE[locale] ?? en;
}
