// Slug + naming helpers shared by server and web. No Node or DOM APIs.
import { PREVIEW_HOST_PREFIX, RESERVED_SLUGS } from './constants';

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // Uzbek Cyrillic
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

const APOSTROPHES = /[ʻʼ‘’`´']/g;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function randomSuffix(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE32[Math.floor(Math.random() * BASE32.length)];
  return out;
}

/** Lowercase ASCII slug: transliterates Cyrillic (incl. Uzbek), strips diacritics and apostrophes. May return "". */
export function slugifyRaw(input: string, maxLength = 40): string {
  let s = input.toLowerCase().replace(APOSTROPHES, '');
  s = Array.from(s, (ch) => (ch in CYRILLIC ? CYRILLIC[ch] : ch)).join('');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/-+$/g, '');
  return s;
}

/** Like slugifyRaw but never empty and never shorter than 3 chars. */
export function slugify(input: string, maxLength = 40): string {
  let s = slugifyRaw(input, maxLength);
  if (s.startsWith(PREVIEW_HOST_PREFIX)) s = `app-${s}`.slice(0, maxLength).replace(/-+$/g, '');
  if (s.length >= 3 && !isReservedSlug(s)) return s;
  if (s.length >= 1) return `${s.slice(0, maxLength - 5)}-${randomSuffix(4)}`;
  return `app-${randomSuffix(4)}`;
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

/** Returns an error message or null when the slug may be used for publishing. */
export function slugError(slug: string): string | null {
  if (slug.length < 3) return 'Use at least 3 characters';
  if (slug.length > 40) return 'Use at most 40 characters';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use only lowercase letters, numbers and hyphens';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'Cannot start or end with a hyphen';
  if (slug.includes('--')) return 'Cannot contain two hyphens in a row';
  if (slug.startsWith(PREVIEW_HOST_PREFIX)) return `Cannot start with "${PREVIEW_HOST_PREFIX}"`;
  if (isReservedSlug(slug)) return 'This name is reserved';
  return null;
}

export function isValidSlug(slug: string): boolean {
  return slugError(slug) === null;
}

const FILLER = new Set([
  // en
  'build', 'create', 'make', 'generate', 'design', 'develop', 'me', 'a', 'an', 'the', 'please', 'i', 'want', 'need', 'to',
  // uz
  'yarat', 'yaratib', 'yasa', 'yasab', 'qil', 'qilib', 'tuz', 'tuzib', 'ber', 'bering', 'menga', 'iltimos', 'bitta',
  // ru
  'сделай', 'создай', 'сгенерируй', 'напиши', 'построй', 'мне', 'пожалуйста', 'хочу', 'нужен', 'нужно', 'нужна',
]);

/** Short provisional project name derived from the first prompt. */
export function provisionalName(prompt: string): string {
  const words = prompt
    .replace(/[\r\n]+/g, ' ')
    .replace(/[.,!?;:"()[\]{}<>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let start = 0;
  while (start < words.length && FILLER.has(words[start].toLowerCase())) start++;
  let end = words.length;
  while (end > start && FILLER.has(words[end - 1].toLowerCase())) end--;
  const picked = words.slice(start, Math.min(end, start + 5));
  if (picked.length === 0) return 'New project';
  let name = picked.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (name.length > 40) name = name.slice(0, 40).trim();
  return name || 'New project';
}

/** Short sandbox-safe file name for downloads: "<slug>.zip". */
export function downloadFileName(projectName: string): string {
  return `${slugifyRaw(projectName) || 'yasa-app'}.zip`;
}
