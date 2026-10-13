import { describe, expect, it } from 'vitest';
import { countLines, extname, isBinaryPath, languageFor, mimeFor, normalizePath, pathError, versionPreviewUrl } from '../../shared/paths';
import { downloadFileName, isValidSlug, provisionalName, slugError, slugify, slugifyRaw } from '../../shared/slug';

describe('paths', () => {
  it('normalizes and validates', () => {
    expect(normalizePath('./src\\a.ts')).toBe('src/a.ts');
    expect(normalizePath('/src//a.ts')).toBe('src/a.ts');
    expect(pathError('src/components/ui/button.tsx')).toBeNull();
    expect(pathError('src/pages/[id].tsx')).toBeNull();
    for (const bad of ['', 'a/../b', 'node_modules/x', '.git/config', 'dist/x.js', 'C:/x', 'a/b/', 'a<b>.ts', `${'a'.repeat(201)}.ts`]) {
      expect(pathError(bad), bad).not.toBeNull();
    }
  });

  it('classifies files', () => {
    expect(extname('src/App.TSX')).toBe('tsx');
    expect(extname('.gitignore')).toBe('');
    expect(languageFor('a.tsx')).toBe('typescript');
    expect(languageFor('a.css')).toBe('css');
    expect(languageFor('LICENSE')).toBe('text');
    expect(isBinaryPath('public/a.png')).toBe(true);
    expect(isBinaryPath('public/a.svg')).toBe(false);
    expect(mimeFor('a.svg')).toBe('image/svg+xml');
    expect(mimeFor('a.unknown')).toBe('application/octet-stream');
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
  });

  it('builds version preview urls', () => {
    expect(versionPreviewUrl('http://pv-abc.localhost:3000/', 7)).toBe('http://pv-abc--v7.localhost:3000/');
    expect(versionPreviewUrl('https://pv-abc.yasa-apps.com/', 12)).toBe('https://pv-abc--v12.yasa-apps.com/');
  });
});

describe('slugs', () => {
  it('transliterates Uzbek and Cyrillic names', () => {
    expect(slugifyRaw('Oʻquv markazi')).toBe('oquv-markazi');
    expect(slugifyRaw("G'ijduvon choyxonasi")).toBe('gijduvon-choyxonasi');
    expect(slugifyRaw('Гулли дўкон')).toBe('gulli-dokon');
    expect(slugifyRaw('Кафе «Щука»')).toBe('kafe-shchuka');
    expect(slugifyRaw('Café Déjà Vu!')).toBe('cafe-deja-vu');
    expect(slugifyRaw('🎉🎉')).toBe('');
  });

  it('always produces a publishable slug', () => {
    expect(slugify('My Shop')).toBe('my-shop');
    expect(isValidSlug(slugify('🎉'))).toBe(true);
    expect(isValidSlug(slugify('ab'))).toBe(true);
    expect(isValidSlug(slugify('admin'))).toBe(true);
    expect(isValidSlug(slugify('pv-something'))).toBe(true);
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it('validates slugs', () => {
    expect(slugError('my-app')).toBeNull();
    for (const bad of ['ab', 'A-b-c', 'a--b', '-ab', 'ab-', 'pv-abc', 'www', 'a b c', 'x'.repeat(41)]) {
      expect(slugError(bad), bad).not.toBeNull();
    }
  });

  it('derives provisional project names in three languages', () => {
    expect(provisionalName('Build me a todo app for my team')).toBe('Todo App For My Team');
    expect(provisionalName('menga choyxona menyusi sayti yasab ber')).toBe('Choyxona Menyusi Sayti');
    expect(provisionalName('Сделай мне сайт для кофейни, пожалуйста')).toBe('Сайт Для Кофейни');
    expect(provisionalName('   ')).toBe('New project');
    expect(provisionalName('a '.repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it('names downloads safely', () => {
    expect(downloadFileName('Gulli doʻkon')).toBe('gulli-dokon.zip');
    expect(downloadFileName('"../../etc"')).toBe('etc.zip');
    expect(downloadFileName('🎉')).toBe('yasa-app.zip');
  });
});
