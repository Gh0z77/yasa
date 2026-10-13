import { describe, expect, it } from 'vitest';
import {
  REACT_SPECIFIERS,
  buildImportMap,
  cdnUrlFor,
  cssCdnUrl,
  declaredVersion,
  isBareSpecifier,
  isCssSpecifier,
  normalizeRange,
  parseSpecifier,
  readPackageJson,
} from '../../../server/preview/importmap';
import { file, fixtureFiles } from './fixture';

const pkg = {
  dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', 'lucide-react': '^1.0.0', '@tanstack/react-query': '~5.50.1', zustand: 'workspace:^5.0.0' },
  devDependencies: { leaflet: '1.9.4', weird: 'github:user/repo', ranged: '>=2 <4' },
};

describe('import map', () => {
  it('has the documented shape in preview mode', () => {
    const map = buildImportMap(['lucide-react', 'react', '@tanstack/react-query', 'lucide-react', 'zustand/middleware', 'unknown/sub/path'], pkg, 'preview');
    expect(map).toEqual({
      imports: {
        react: 'https://esm.sh/react@^19.0.0?dev',
        'react/jsx-runtime': 'https://esm.sh/react@^19.0.0/jsx-runtime?dev',
        'react/jsx-dev-runtime': 'https://esm.sh/react@^19.0.0/jsx-dev-runtime?dev',
        'react/compiler-runtime': 'https://esm.sh/react@^19.0.0/compiler-runtime?dev',
        'react-dom': 'https://esm.sh/react-dom@^19.0.0?external=react&dev',
        'react-dom/client': 'https://esm.sh/react-dom@^19.0.0/client?external=react&dev',
        'react-dom/server': 'https://esm.sh/react-dom@^19.0.0/server?external=react&dev',
        '@tanstack/react-query': 'https://esm.sh/@tanstack/react-query@~5.50.1?external=react,react-dom',
        'lucide-react': 'https://esm.sh/lucide-react@^1?external=react,react-dom',
        'unknown/sub/path': 'https://esm.sh/unknown/sub/path?external=react,react-dom',
        'zustand/middleware': 'https://esm.sh/zustand@^5/middleware?external=react,react-dom',
      },
    });
  });

  it('uses production React in publish mode', () => {
    const map = buildImportMap(['lucide-react'], pkg, 'publish');
    expect(map.imports.react).toBe('https://esm.sh/react@^19.0.0');
    expect(map.imports['react/jsx-runtime']).toBe('https://esm.sh/react@^19.0.0/jsx-runtime');
    expect(map.imports['react-dom']).toBe('https://esm.sh/react-dom@^19.0.0?external=react');
    expect(map.imports['react-dom/client']).toBe('https://esm.sh/react-dom@^19.0.0/client?external=react');
    expect(map.imports['lucide-react']).toBe('https://esm.sh/lucide-react@^1?external=react,react-dom');
    // no `dev` query flag anywhere (the specifier "react/jsx-dev-runtime" itself is fine)
    expect(Object.values(map.imports).filter((url) => /[?&]dev(?:[&=]|$)/.test(url))).toEqual([]);
  });

  it('always contains the React entries, even without package.json or externals', () => {
    const map = buildImportMap([], null, 'publish');
    for (const spec of REACT_SPECIFIERS) expect(map.imports[spec]).toBeDefined();
    expect(map.imports.react).toBe('https://esm.sh/react');
    expect(map.imports['react-dom/client']).toBe('https://esm.sh/react-dom/client?external=react');
    // exact specifiers only — no prefix maps, no relative or URL specifiers
    const weird = buildImportMap(['./local', '/abs', '@/alias', 'https://x.y/z.js', 'node:fs'], null, 'preview');
    expect(Object.keys(weird.imports).sort()).toEqual([...REACT_SPECIFIERS].sort());
    expect(Object.keys(weird.imports).some((k) => k.endsWith('/'))).toBe(false);
  });

  it('falls back to the react range for an undeclared react-dom', () => {
    expect(cdnUrlFor('react-dom/client', { dependencies: { react: '^18.3.1' } }, 'publish')).toBe('https://esm.sh/react-dom@^18.3.1/client?external=react');
  });

  it('normalizes version ranges', () => {
    expect(normalizeRange('^19.0.0')).toBe('^19.0.0');
    expect(normalizeRange(' ~1.2 ')).toBe('~1.2');
    expect(normalizeRange('1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(normalizeRange('v2.0.0')).toBe('2.0.0');
    expect(normalizeRange('workspace:^5.0.0')).toBe('^5.0.0');
    expect(normalizeRange('workspace:*')).toBeNull();
    expect(normalizeRange('npm:preact@^10.0.0')).toBe('^10.0.0');
    expect(normalizeRange('next')).toBe('next');
    expect(normalizeRange('latest')).toBeNull();
    expect(normalizeRange('*')).toBeNull();
    expect(normalizeRange('')).toBeNull();
    expect(normalizeRange('>=2 <4')).toBeNull();
    expect(normalizeRange('1.x || 2.x')).toBeNull();
    expect(normalizeRange('github:user/repo')).toBeNull();
    expect(normalizeRange('https://example.com/x.tgz')).toBeNull();
    expect(normalizeRange('file:../x')).toBeNull();
    expect(declaredVersion(pkg, 'leaflet')).toBe('1.9.4');
    expect(declaredVersion(pkg, 'weird')).toBeNull();
    expect(declaredVersion(pkg, 'ranged')).toBeNull();
    expect(declaredVersion(pkg, 'nope')).toBeNull();
    expect(declaredVersion(null, 'react')).toBeNull();
  });

  it('parses specifiers', () => {
    expect(parseSpecifier('react')).toEqual({ name: 'react', subpath: '' });
    expect(parseSpecifier('react-dom/client')).toEqual({ name: 'react-dom', subpath: 'client' });
    expect(parseSpecifier('@scope/pkg')).toEqual({ name: '@scope/pkg', subpath: '' });
    expect(parseSpecifier('@scope/pkg/a/b.css')).toEqual({ name: '@scope/pkg', subpath: 'a/b.css' });
    expect(isBareSpecifier('react')).toBe(true);
    expect(isBareSpecifier('@scope/pkg')).toBe(true);
    expect(isBareSpecifier('@/lib/utils')).toBe(false);
    expect(isBareSpecifier('./x')).toBe(false);
    expect(isBareSpecifier('/x')).toBe(false);
    expect(isBareSpecifier('https://esm.sh/x')).toBe(false);
    expect(isBareSpecifier('node:fs')).toBe(false);
  });

  it('builds stylesheet CDN URLs', () => {
    expect(isCssSpecifier('leaflet/dist/leaflet.css')).toBe(true);
    expect(isCssSpecifier('@fontsource/inter')).toBe(true);
    expect(isCssSpecifier('react')).toBe(false);
    expect(isCssSpecifier('./local.css')).toBe(false);
    expect(cssCdnUrl('leaflet/dist/leaflet.css', pkg)).toBe('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css');
    expect(cssCdnUrl('swiper/css', null)).toBe('https://cdn.jsdelivr.net/npm/swiper/css');
    expect(cssCdnUrl('@fontsource/inter', null)).toBe('https://cdn.jsdelivr.net/npm/@fontsource/inter/index.css');
    expect(cssCdnUrl('@fontsource/inter/400', null)).toBe('https://cdn.jsdelivr.net/npm/@fontsource/inter/400.css');
    expect(cssCdnUrl('@fontsource-variable/inter/wght.css', null)).toBe('https://cdn.jsdelivr.net/npm/@fontsource-variable/inter/wght.css');
  });

  it('reads package.json from the project files', () => {
    expect(readPackageJson(fixtureFiles())?.dependencies?.react).toBe('^19.0.0');
    expect(readPackageJson([])).toBeNull();
    expect(readPackageJson([file('package.json', '{ not json')])).toBeNull();
    expect(readPackageJson([file('package.json', '[]')])).toBeNull();
    const b64 = file('package.json', Buffer.from('{"dependencies":{"a":"1.0.0"}}').toString('base64'), 'base64');
    expect(readPackageJson([b64])?.dependencies?.a).toBe('1.0.0');
  });
});
