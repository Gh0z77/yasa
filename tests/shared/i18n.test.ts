// Consistency of the UI dictionaries (SPEC §15.10): identical key sets, Uzbek typography, no empty strings,
// and the same {placeholders} in every locale.
import { describe, expect, it } from 'vitest';

import { auth as enAuth } from '../../web/src/i18n/locales/en/auth';
import { chat as enChat } from '../../web/src/i18n/locales/en/chat';
import { code as enCode } from '../../web/src/i18n/locales/en/code';
import { common as enCommon } from '../../web/src/i18n/locales/en/common';
import { home as enHome } from '../../web/src/i18n/locales/en/home';
import { landing as enLanding } from '../../web/src/i18n/locales/en/landing';
import { preview as enPreview } from '../../web/src/i18n/locales/en/preview';
import { settings as enSettings } from '../../web/src/i18n/locales/en/settings';
import { shell as enShell } from '../../web/src/i18n/locales/en/shell';
import { workspace as enWorkspace } from '../../web/src/i18n/locales/en/workspace';

import { auth as ruAuth } from '../../web/src/i18n/locales/ru/auth';
import { chat as ruChat } from '../../web/src/i18n/locales/ru/chat';
import { code as ruCode } from '../../web/src/i18n/locales/ru/code';
import { common as ruCommon } from '../../web/src/i18n/locales/ru/common';
import { home as ruHome } from '../../web/src/i18n/locales/ru/home';
import { landing as ruLanding } from '../../web/src/i18n/locales/ru/landing';
import { preview as ruPreview } from '../../web/src/i18n/locales/ru/preview';
import { settings as ruSettings } from '../../web/src/i18n/locales/ru/settings';
import { shell as ruShell } from '../../web/src/i18n/locales/ru/shell';
import { workspace as ruWorkspace } from '../../web/src/i18n/locales/ru/workspace';

import { auth as uzAuth } from '../../web/src/i18n/locales/uz/auth';
import { chat as uzChat } from '../../web/src/i18n/locales/uz/chat';
import { code as uzCode } from '../../web/src/i18n/locales/uz/code';
import { common as uzCommon } from '../../web/src/i18n/locales/uz/common';
import { home as uzHome } from '../../web/src/i18n/locales/uz/home';
import { landing as uzLanding } from '../../web/src/i18n/locales/uz/landing';
import { preview as uzPreview } from '../../web/src/i18n/locales/uz/preview';
import { settings as uzSettings } from '../../web/src/i18n/locales/uz/settings';
import { shell as uzShell } from '../../web/src/i18n/locales/uz/shell';
import { workspace as uzWorkspace } from '../../web/src/i18n/locales/uz/workspace';

interface Dict {
  readonly [key: string]: string | Dict;
}

type LocaleCode = 'en' | 'uz' | 'ru';

// Same namespace list as web/src/i18n/resources.ts.
const dictionaries: Record<LocaleCode, Record<string, Dict>> = {
  en: {
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
  },
  uz: {
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
  },
  ru: {
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
  },
};

const NAMESPACES = Object.keys(dictionaries.en);
const TRANSLATIONS = ['uz', 'ru'] as const;
const ALL_LOCALES = ['en', 'uz', 'ru'] as const;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** { a: { b: 'x' } } → Map { 'a.b' → 'x' } */
function flatten(node: Dict, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
}

const lastSegment = (path: string): string => path.slice(path.lastIndexOf('.') + 1);
const isPlural = (path: string): boolean => PLURAL_SUFFIX.test(lastSegment(path));
/** "count.files_one" → "count.files"; other keys are returned unchanged. */
const pluralBase = (path: string): string => (isPlural(path) ? path.replace(PLURAL_SUFFIX, '') : path);
/** Key identity for the comparison between locales: all plural variants of a key collapse into one entry. */
const normalizedKey = (path: string): string => (isPlural(path) ? `${pluralBase(path)}_<plural>` : path);

const placeholders = (text: string): string[] => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))].sort();

const cases = NAMESPACES.flatMap((namespace) => TRANSLATIONS.map((locale) => ({ namespace, locale })));
const allCases = NAMESPACES.flatMap((namespace) => ALL_LOCALES.map((locale) => ({ namespace, locale })));

function dict(locale: LocaleCode, namespace: string): Map<string, string> {
  const node = dictionaries[locale][namespace];
  if (!node) throw new Error(`Missing dictionary ${locale}/${namespace}`);
  return flatten(node);
}

describe('i18n dictionaries', () => {
  it('registers the same namespaces for every locale', () => {
    for (const locale of TRANSLATIONS) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  // (a) identical key sets; plural variants (_one/_few/_many/_other) may differ by category
  it.each(cases)('$locale/$namespace has the same keys as en/$namespace', ({ namespace, locale }) => {
    const source = new Set([...dict('en', namespace).keys()].map(normalizedKey));
    const target = new Set([...dict(locale, namespace).keys()].map(normalizedKey));
    const missing = [...source].filter((key) => !target.has(key)).sort();
    const extra = [...target].filter((key) => !source.has(key)).sort();
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  // Every plural key needs the catch-all form; Russian needs all four categories.
  it.each(allCases)('$locale/$namespace has complete plural forms', ({ namespace, locale }) => {
    const keys = new Set(dict(locale, namespace).keys());
    const required = locale === 'ru' ? ['one', 'few', 'many', 'other'] : ['other'];
    const problems: string[] = [];
    for (const base of new Set([...keys].filter(isPlural).map(pluralBase))) {
      for (const category of required) {
        if (!keys.has(`${base}_${category}`)) problems.push(`${base}_${category}`);
      }
    }
    expect(problems.sort()).toEqual([]);
  });

  // (b) Uzbek typography: ʻ (U+02BB) in oʻ / gʻ and ʼ (U+02BC) for the tutuq belgisi
  it.each(NAMESPACES.map((namespace) => ({ namespace })))(
    'uz/$namespace contains no ASCII apostrophes or backticks',
    ({ namespace }) => {
      const problems = [...dict('uz', namespace)]
        .filter(([, value]) => /['`]/.test(value))
        .map(([key, value]) => `${key}: ${value}`);
      expect(problems).toEqual([]);
    },
  );

  // (c) no empty strings, except the `_placeholder` key of a namespace that is not filled in yet
  it.each(allCases)('$locale/$namespace has no empty values', ({ namespace, locale }) => {
    const problems = [...dict(locale, namespace)]
      .filter(([key, value]) => lastSegment(key) !== '_placeholder' && value.trim() === '')
      .map(([key]) => key);
    expect(problems).toEqual([]);
  });

  // (d) every {placeholder} of the English string is present in the translation
  it.each(cases)('$locale/$namespace keeps the {placeholders} of en/$namespace', ({ namespace, locale }) => {
    const source = dict('en', namespace);
    const target = dict(locale, namespace);
    const problems: string[] = [];
    for (const [key, value] of target) {
      // A plural form without an English twin (ru `_few`, `_many`) is compared with the English `_other` form.
      const original = source.get(key) ?? (isPlural(key) ? source.get(`${pluralBase(key)}_other`) : undefined);
      if (original === undefined) continue; // reported by the key-set test
      const present = new Set(placeholders(value));
      const missing = placeholders(original).filter((name) => !present.has(name));
      if (missing.length > 0) problems.push(`${key}: missing ${missing.map((name) => `{${name}}`).join(', ')}`);
    }
    expect(problems.sort()).toEqual([]);
  });
});
