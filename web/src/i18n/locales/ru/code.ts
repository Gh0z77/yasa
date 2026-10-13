import type { DictShape } from '../../types';
import type { code as en } from '../en/code';

export const code = {
  tree: {
    title: 'Файлы',
    search: 'Фильтр файлов…',
    newFile: 'Новый файл',
    newFilePlaceholder: 'src/components/Name.tsx',
    rename: 'Переименовать',
    delete: 'Удалить',
    noMatch: 'Файлы не найдены',
    toggle: 'Показать или скрыть список файлов',
    exists: 'Файл с таким именем уже существует',
    created: 'Файл создан',
    renamed: 'Файл переименован',
    deleted: 'Файл удалён',
  },
  editor: {
    emptyTitle: 'Выберите файл',
    emptyHint: 'Выберите файл слева, чтобы посмотреть или изменить код.',
    aiWriting: 'ИИ пишет…',
    aiWorking: 'ИИ работает — редактирование приостановлено',
    readOnly: 'Только чтение',
    binary: 'Это двоичный файл, здесь его редактировать нельзя.',
    saving: 'Сохранение…',
    saved: 'Сохранено',
    saveFailed: 'Не удалось сохранить',
    unsaved: 'Несохранённые изменения',
    closeTab: 'Закрыть вкладку',
    problems: 'Проблемы',
    lines: 'строк: {count}',
  },
} as const satisfies DictShape<typeof en>;
