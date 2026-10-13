// Locale-aware formatting through Intl (SPEC §15.10). Pass the active locale from `useLocale()`.

/** BCP-47 tags used for Intl per UI locale (Uzbek explicitly in Latin script). */
const INTL_LOCALE: Record<string, string> = { en: 'en', uz: 'uz-Latn-UZ', ru: 'ru' };

function intlLocale(locale: string): string {
  // Runtimes without Uzbek data would fall back to the system language; neutral English reads better in a Latin UI.
  if (locale === 'uz' && !hasUzbekData()) return 'en-GB';
  return INTL_LOCALE[locale] ?? locale;
}

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

function rtf(locale: string, style: Intl.RelativeTimeFormatStyle): Intl.RelativeTimeFormat {
  return memo(`rtf:${locale}:${style}`, () => new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto', style }));
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/** Some runtimes (e.g. Electron builds with small ICU) have no Uzbek data and would print "-14 min". */
function hasUzbekData(): boolean {
  // supportedLocalesOf() can claim support while only root data exists, so look at real output instead.
  return memo('uz:data', () => {
    try {
      return /yanvar/i.test(new Intl.DateTimeFormat('uz-Latn-UZ', { month: 'long' }).format(new Date(2024, 0, 15)));
    } catch {
      return false;
    }
  });
}

const UZ_UNITS: Partial<Record<Intl.RelativeTimeFormatUnit, string>> = {
  minute: 'daqiqa',
  hour: 'soat',
  day: 'kun',
  week: 'hafta',
  month: 'oy',
  year: 'yil',
};

const UZ_FALLBACK = {
  format(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    if (unit === 'second') return 'hozirgina';
    if (unit === 'day' && value === -1) return 'kecha';
    if (unit === 'day' && value === 1) return 'ertaga';
    const name = UZ_UNITS[unit] ?? unit;
    return value < 0 ? `${Math.abs(value)} ${name} oldin` : `${value} ${name}dan keyin`;
  },
};

/**
 * "just now", "5 minutes ago", "yesterday", "3 weeks ago", "2 months ago"… in the given locale.
 * Future dates work too ("in 3 hours"). Invalid input → "".
 */
export function relativeTime(
  iso: string | number | Date,
  locale: string,
  opts: { now?: number; style?: Intl.RelativeTimeFormatStyle } = {},
): string {
  const time = toDate(iso).getTime();
  if (Number.isNaN(time)) return '';
  const f = hasUzbekData() || locale !== 'uz' ? rtf(locale, opts.style ?? 'long') : UZ_FALLBACK;
  const diff = Math.round((time - (opts.now ?? Date.now())) / 1000); // negative = past
  const abs = Math.abs(diff);
  const sign = diff < 0 ? -1 : 1;
  if (abs < 45) return f.format(0, 'second'); // "now" / "hozir" / "сейчас"
  if (abs < 45 * MINUTE) return f.format(sign * Math.max(1, Math.round(abs / MINUTE)), 'minute');
  if (abs < 22 * HOUR) return f.format(sign * Math.max(1, Math.round(abs / HOUR)), 'hour');
  if (abs < 6.5 * DAY) return f.format(sign * Math.max(1, Math.round(abs / DAY)), 'day');
  if (abs < 26 * DAY) return f.format(sign * Math.max(1, Math.round(abs / (7 * DAY))), 'week');
  if (abs < 320 * DAY) return f.format(sign * Math.max(1, Math.round(abs / (30.44 * DAY))), 'month');
  return f.format(sign * Math.max(1, Math.round(abs / (365.25 * DAY))), 'year');
}

/** "Oct 11, 2026" / "11-okt, 2026" / "11 окт. 2026 г." */
export function formatDate(iso: string | number | Date, locale: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  const options = opts ?? { dateStyle: 'medium' };
  return memo(`dtf:${locale}:${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(intlLocale(locale), options)).format(d);
}

/** "Oct 11, 2026, 14:05" in the user's time zone. */
export function formatDateTime(iso: string | number | Date, locale: string): string {
  return formatDate(iso, locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Local wall-clock time "14:05" (e.g. for "resets at HH:MM"). */
export function formatTime(iso: string | number | Date, locale: string): string {
  return formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
}

/** Locale-aware number; `compact` gives "1.2K". */
export function formatNumber(value: number, locale: string, opts: Intl.NumberFormatOptions & { compact?: boolean } = {}): string {
  const { compact, ...rest } = opts;
  const options: Intl.NumberFormatOptions = compact ? { notation: 'compact', maximumFractionDigits: 1, ...rest } : rest;
  return memo(`nf:${locale}:${JSON.stringify(options)}`, () => new Intl.NumberFormat(intlLocale(locale), options)).format(value);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** "512 B", "1.4 kB", "5 MB" (1024-based, localized digits/units). */
export function formatBytes(bytes: number, locale = 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  try {
    return formatNumber(value, locale, {
      style: 'unit',
      unit: BYTE_UNITS[unit],
      unitDisplay: 'narrow',
      maximumFractionDigits: digits,
    });
  } catch {
    return `${value.toFixed(digits)} ${['B', 'kB', 'MB', 'GB'][unit]}`;
  }
}

interface DurationFormatLike {
  format(duration: Record<string, number>): string;
}
type DurationFormatCtor = new (locale: string, options: { style: 'narrow' | 'short' | 'long' }) => DurationFormatLike;

function durationFormatter(locale: string): DurationFormatLike | null {
  return memo<DurationFormatLike | null>(`dur:${locale}`, () => {
    const Ctor = (Intl as unknown as { DurationFormat?: DurationFormatCtor }).DurationFormat;
    if (!Ctor) return null;
    try {
      return new Ctor(intlLocale(locale), { style: 'narrow' });
    } catch {
      return null;
    }
  });
}

/**
 * Compact duration: "850ms", "12s", "1m 12s", "2h 5m" — localized units when `Intl.DurationFormat` exists
 * ("1 мин 12 с"), otherwise the English short form.
 */
export function formatDuration(ms: number, locale = 'en'): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const seconds = total % MINUTE;
  const parts: Record<string, number> = {};
  if (hours > 0) {
    parts.hours = hours;
    if (minutes > 0) parts.minutes = minutes;
  } else if (minutes > 0) {
    parts.minutes = minutes;
    if (seconds > 0) parts.seconds = seconds;
  } else {
    parts.seconds = seconds;
  }
  if (locale === 'uz' && !hasUzbekData()) {
    // Without Uzbek ICU data Intl would silently use the system language.
    return [parts.hours && `${parts.hours} soat`, parts.minutes && `${parts.minutes} daq`, parts.seconds !== undefined && `${parts.seconds} s`]
      .filter(Boolean)
      .join(' ');
  }
  const f = durationFormatter(locale);
  if (f) {
    try {
      return f.format(parts);
    } catch {
      /* fall through */
    }
  }
  return [parts.hours && `${parts.hours}h`, parts.minutes && `${parts.minutes}m`, parts.seconds !== undefined && `${parts.seconds}s`]
    .filter(Boolean)
    .join(' ');
}
