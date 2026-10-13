// i18n runtime (SPEC §11.3 + §15.10).
//
//   const t = useT('common');
//   t('actions.save')                         → "Save"
//   t('confirm.deleteTitle', { name })        → "Delete “My app”?"
//   t('count.files', { count: 3 })            → "3 files"   (resolves count.files_one | _few | _many | _other)
//   const { locale, setLocale } = useLocale();
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '@shared/types';
// Relative (not "@/") so the module also loads in plain vitest without the Vite alias.
import { ApiError } from '../lib/api-error';
import { en, resources, type Dictionaries, type Namespace } from './resources';
import type { DictNode, PluralCategory, TKey, TVars } from './types';

export type { Namespace, Dictionaries } from './resources';
export type { DictShape, DeepStringify, TKey, TVars } from './types';

export const LOCALE_STORAGE_KEY = 'yasa:locale';
export const DEFAULT_LOCALE: Locale = 'en';

export interface LocaleInfo {
  code: Locale;
  /** Name in its own language (shown in the switcher). */
  nativeName: string;
  /** English name. */
  name: string;
  /** Two-letter badge. */
  short: string;
  /** BCP-47 tag for Intl APIs. */
  intl: string;
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en', nativeName: 'English', name: 'English', short: 'EN', intl: 'en' },
  { code: 'uz', nativeName: 'Oʻzbekcha', name: 'Uzbek', short: 'UZ', intl: 'uz-Latn-UZ' },
  { code: 'ru', nativeName: 'Русский', name: 'Russian', short: 'RU', intl: 'ru' },
];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'uz' || value === 'ru';
}

/** "uz-Latn-UZ" → "uz"; unsupported → null. */
function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

/** Detection order: localStorage → first matching navigator language → VITE_DEFAULT_LOCALE → en. */
export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* storage blocked */
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const match = matchLocale(lang);
      if (match) return match;
    }
  }
  return matchLocale(import.meta.env?.VITE_DEFAULT_LOCALE) ?? DEFAULT_LOCALE;
}

// ---------------------------------------------------------------------------
// Pure translation core (usable outside React through `translate`)
// ---------------------------------------------------------------------------
const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralCategory(locale: Locale, count: number): PluralCategory {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count) as PluralCategory;
}

const numberFormats = new Map<Locale, Intl.NumberFormat>();
function formatCount(locale: Locale, value: number): string {
  let nf = numberFormats.get(locale);
  if (!nf) {
    nf = new Intl.NumberFormat(LOCALES.find((l) => l.code === locale)?.intl ?? locale);
    numberFormats.set(locale, nf);
  }
  return nf.format(value);
}

function lookup(dict: DictNode, key: string): string | undefined {
  let node: string | DictNode | undefined = dict;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function resolve(dict: DictNode, locale: Locale, key: string, vars: TVars | undefined): string | undefined {
  const count = vars?.count;
  if (typeof count === 'number') {
    if (count === 0) {
      const zero = lookup(dict, `${key}_zero`);
      if (zero !== undefined) return zero;
    }
    const plural = lookup(dict, `${key}_${pluralCategory(locale, count)}`) ?? lookup(dict, `${key}_other`);
    if (plural !== undefined) return plural;
  }
  return lookup(dict, key);
}

function interpolate(template: string, locale: Locale, vars: TVars | undefined): string {
  if (!vars || template.indexOf('{') === -1) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null) return match;
    return name === 'count' && typeof value === 'number' ? formatCount(locale, value) : String(value);
  });
}

/** Untyped core: resolves `key` in `namespace` for `locale`, falling back to English, then to the key itself. */
export function translateRaw(locale: Locale, namespace: Namespace, key: string, vars?: TVars): string {
  const dict = resources[locale]?.[namespace] as DictNode | undefined;
  let template = dict ? resolve(dict, locale, key, vars) : undefined;
  if (template === undefined && locale !== 'en') template = resolve(en[namespace] as DictNode, 'en', key, vars);
  if (template === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key ${namespace}:${key}`);
    return key;
  }
  return interpolate(template, locale, vars);
}

export type TFunction<N extends Namespace> = (key: TKey<Dictionaries[N]>, vars?: TVars) => string;

/** Typed translator bound to a locale + namespace (for code outside React). */
export function getT<N extends Namespace>(locale: Locale, namespace: N): TFunction<N> {
  return (key, vars) => translateRaw(locale, namespace, key, vars);
}

/** One-off typed translation outside React. */
export function translate<N extends Namespace>(locale: Locale, namespace: N, key: TKey<Dictionaries[N]>, vars?: TVars): string {
  return translateRaw(locale, namespace, key, vars);
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------
interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

let activeLocale: Locale = DEFAULT_LOCALE;

/** Active UI locale for non-React code (e.g. building a ChatRequest). Prefer `useLocale()` in components. */
export function getLocale(): Locale {
  return activeLocale;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = initialLocale ?? detectLocale();
    activeLocale = initial;
    return initial;
  });

  activeLocale = locale;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Keep several tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY && isLocale(e.newValue)) setLocaleState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* storage blocked: still switch for this session */
    }
    activeLocale = next;
    setLocaleState(next);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT/useLocale must be used inside <I18nProvider>');
  return ctx;
}

/** `{ locale, setLocale, locales }` — setLocale persists to localStorage and updates `<html lang>`. */
export function useLocale(): I18nContextValue & { locales: readonly LocaleInfo[] } {
  const ctx = useI18n();
  return useMemo(() => ({ ...ctx, locales: LOCALES }), [ctx]);
}

/**
 * Translator for one namespace, typed against the English dictionary:
 * `const t = useT('chat'); t('composer.placeholder')`. The function identity changes only with the locale.
 */
export function useT<N extends Namespace>(namespace: N): TFunction<N> {
  const { locale } = useI18n();
  return useMemo(() => getT(locale, namespace), [locale, namespace]);
}

/**
 * Maps any thrown value to a localized, user-facing message (by `ApiErrorCode`).
 * `const errorMessage = useErrorMessage(); toast.error(errorMessage(err));`
 */
export function useErrorMessage(): (error: unknown) => string {
  const t = useT('common');
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        const key = `errors.${error.code}` as TKey<Dictionaries['common']>;
        const message = t(key);
        return message === key ? t('errors.unknown') : message;
      }
      return t('errors.unknown');
    },
    [t],
  );
}
