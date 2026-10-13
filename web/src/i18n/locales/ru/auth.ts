// Russian. Formal «вы»; buttons are infinitives.
import type { DictShape } from '../../types';
import type { auth as en } from '../en/auth';

export const auth = {
  login: {
    title: 'С возвращением',
    subtitle: 'Войдите, чтобы продолжить работу',
    submit: 'Войти',
    noAccount: 'Впервые в Yasa?',
    signupLink: 'Создать аккаунт',
    success: 'С возвращением, {name}!',
  },

  signup: {
    title: 'Создайте аккаунт',
    subtitle: 'Начните создавать приложения и сайты в диалоге с ИИ',
    submit: 'Создать аккаунт',
    haveAccount: 'Уже есть аккаунт?',
    loginLink: 'Войти',
    success: 'Добро пожаловать в Yasa, {name}!',
    pendingPrompt: 'Ваша идея сохранена. Мы начнём создавать проект сразу после регистрации.',
    terms: 'Пользоваться можно бесплатно. Банковская карта не нужна.',
  },

  fields: {
    name: 'Имя',
    namePlaceholder: 'Ваше имя',
    email: 'Электронная почта',
    emailPlaceholder: 'vy@example.com',
    password: 'Пароль',
    passwordPlaceholder: 'Ваш пароль',
    newPasswordPlaceholder: 'Не менее {min} символов',
    passwordHint: 'Не менее {min} символов',
    showPassword: 'Показать пароль',
    hidePassword: 'Скрыть пароль',
  },

  validation: {
    nameRequired: 'Введите имя',
    nameTooLong: 'Имя слишком длинное (не более {max} символов)',
    emailRequired: 'Введите адрес электронной почты',
    emailInvalid: 'Введите корректный адрес электронной почты',
    passwordRequired: 'Введите пароль',
    passwordTooShort: 'Пароль должен содержать не менее {min} символов',
    passwordTooLong: 'Пароль слишком длинный (не более {max} символов)',
  },

  errors: {
    invalidCredentials: 'Неверный адрес почты или пароль.',
    emailTaken: 'Аккаунт с этим адресом уже существует. Попробуйте войти.',
  },

  forgot: {
    link: 'Забыли пароль?',
    title: 'Сброс пароля',
    note: 'Yasa не отправляет письма. Попросите администратора этого сервера сбросить ваш пароль. Он выполнит команду:',
    after: 'Администратор получит временный пароль. Войдите с ним и смените пароль в Настройках.',
  },
} as const satisfies DictShape<typeof en>;
