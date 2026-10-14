import type { DictShape } from '../../types';
import type { preview as en } from '../en/preview';

export const preview = {
  toolbar: {
    desktop: 'Компьютер',
    tablet: 'Планшет',
    mobile: 'Телефон',
    reload: 'Обновить предпросмотр',
    openNewTab: 'Открыть в новой вкладке',
    console: 'Консоль',
    route: 'Путь страницы',
    selecting: 'Нажмите на элемент',
    frameTitle: 'Предпросмотр приложения',
  },
  loading: {
    title: 'Загрузка предпросмотра…',
    slow: 'Предпросмотр загружается дольше обычного',
    slowHint: 'При первой загрузке скачиваются пакеты приложения — это может занять до полуминуты.',
    openDirect: 'Открыть напрямую',
    misconfigured: 'Предпросмотр на этом сайте не настроен',
    misconfiguredHint: 'Сервер всё ещё использует локальный адрес предпросмотра. Добавьте в Vercel второй домен, укажите его в SANDBOX_DOMAIN, а в SANDBOX_MODE — path (docs/VERCEL.md), затем выполните повторный деплой.',
  },
  firstRun: {
    title: 'Yasa создаёт ваше приложение',
    thinking: 'Думает',
    writing: 'Пишет файлы',
    building: 'Сборка',
    ready: 'Готово',
    tipSelect: 'Совет: с помощью «Выбрать элемент» можно показать, что именно нужно изменить.',
    tipChat: 'Совет: перейдите в режим обсуждения, чтобы спланировать перед созданием.',
    tipHistory: 'Совет: каждое изменение сохраняется как версия, которую можно восстановить.',
  },
  updating: 'Обновление…',
  errors: {
    build: 'Приложение не собирается',
    runtime: 'В приложении произошла ошибка',
    resources: 'Не загрузилось ресурсов: {count}',
    more: 'ещё +{count}',
    fixRequest: 'Исправьте эти ошибки.',
    dismiss: 'Скрыть',
  },
  console: {
    title: 'Консоль',
    empty: 'Пока ничего нет',
    clear: 'Очистить консоль',
    all: 'Все',
    errors: 'Ошибки',
    warnings: 'Предупреждения',
    close: 'Скрыть консоль',
  },
} as const satisfies DictShape<typeof en>;
