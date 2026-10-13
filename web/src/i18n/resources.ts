// Static registry of all dictionaries. Feature teams edit locales/<locale>/<namespace>.ts only.
import type { Locale } from '@shared/types';
import type { DictShape } from './types';

import { auth as enAuth } from './locales/en/auth';
import { chat as enChat } from './locales/en/chat';
import { code as enCode } from './locales/en/code';
import { common as enCommon } from './locales/en/common';
import { home as enHome } from './locales/en/home';
import { landing as enLanding } from './locales/en/landing';
import { preview as enPreview } from './locales/en/preview';
import { settings as enSettings } from './locales/en/settings';
import { shell as enShell } from './locales/en/shell';
import { workspace as enWorkspace } from './locales/en/workspace';

import { auth as ruAuth } from './locales/ru/auth';
import { chat as ruChat } from './locales/ru/chat';
import { code as ruCode } from './locales/ru/code';
import { common as ruCommon } from './locales/ru/common';
import { home as ruHome } from './locales/ru/home';
import { landing as ruLanding } from './locales/ru/landing';
import { preview as ruPreview } from './locales/ru/preview';
import { settings as ruSettings } from './locales/ru/settings';
import { shell as ruShell } from './locales/ru/shell';
import { workspace as ruWorkspace } from './locales/ru/workspace';

import { auth as uzAuth } from './locales/uz/auth';
import { chat as uzChat } from './locales/uz/chat';
import { code as uzCode } from './locales/uz/code';
import { common as uzCommon } from './locales/uz/common';
import { home as uzHome } from './locales/uz/home';
import { landing as uzLanding } from './locales/uz/landing';
import { preview as uzPreview } from './locales/uz/preview';
import { settings as uzSettings } from './locales/uz/settings';
import { shell as uzShell } from './locales/uz/shell';
import { workspace as uzWorkspace } from './locales/uz/workspace';

/** English (source) dictionaries — the types of `t()` keys derive from these. */
export const en = {
  common: enCommon,
  landing: enLanding,
  auth: enAuth,
  home: enHome,
  chat: enChat,
  preview: enPreview,
  code: enCode,
  workspace: enWorkspace,
  settings: enSettings,
  shell: enShell,
} as const;

export type Dictionaries = typeof en;
export type Namespace = keyof Dictionaries;

/** A full translation: every namespace with the English shape. */
export type Translation = { [N in Namespace]: DictShape<Dictionaries[N]> };

const uz = {
  common: uzCommon,
  landing: uzLanding,
  auth: uzAuth,
  home: uzHome,
  chat: uzChat,
  preview: uzPreview,
  code: uzCode,
  workspace: uzWorkspace,
  settings: uzSettings,
  shell: uzShell,
} satisfies Translation;

const ru = {
  common: ruCommon,
  landing: ruLanding,
  auth: ruAuth,
  home: ruHome,
  chat: ruChat,
  preview: ruPreview,
  code: ruCode,
  workspace: ruWorkspace,
  settings: ruSettings,
  shell: ruShell,
} satisfies Translation;

export const resources: Record<Locale, Translation> = { en, uz, ru };

export const NAMESPACES = Object.keys(en) as Namespace[];
