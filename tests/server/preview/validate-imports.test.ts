import { describe, expect, it } from 'vitest';
import { getPackageExports, maskComments, parseNamedImports, suggestName, validateImports } from '../../../server/preview/validate-imports';

const pkg = {
  dependencies: {
    react: '^19.0.0',
    'react-dom': '^19.0.0',
    'lucide-react': '^1.0.0',
    clsx: '^2.1.1',
    'tailwind-merge': '^3.0.0',
    'class-variance-authority': '^0.7.1',
    'radix-ui': '^1.4.0',
    sonner: '^2.0.0',
  },
};

async function check(code: string, path = 'src/A.tsx', p: Parameters<typeof validateImports>[1] = pkg) {
  return validateImports([{ path, content: code }], p);
}

describe('validateImports', () => {
  it('loads the real export lists of the installed packages', async () => {
    const lucide = await getPackageExports('lucide-react');
    expect(lucide?.names.has('ArrowRight')).toBe(true);
    expect(lucide?.names.has('GitFork')).toBe(true);
    expect(lucide?.names.has('Github')).toBe(false);
    expect((await getPackageExports('react'))?.names.has('useState')).toBe(true);
    expect((await getPackageExports('react-dom'))?.names.has('createPortal')).toBe(true);
    expect((await getPackageExports('react-dom/client'))?.names.has('createRoot')).toBe(true);
    expect((await getPackageExports('clsx'))?.names.has('clsx')).toBe(true);
    expect((await getPackageExports('tailwind-merge'))?.names.has('twMerge')).toBe(true);
    expect((await getPackageExports('class-variance-authority'))?.names.has('cva')).toBe(true);
    expect((await getPackageExports('sonner'))?.names.has('toast')).toBe(true);
    expect((await getPackageExports('radix-ui'))?.names.has('Dialog')).toBe(true);
    // cached
    expect(getPackageExports('react')).toBe(getPackageExports('react'));
  });

  it('accepts valid imports', async () => {
    const errors = await check(
      `import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { ArrowRight, Home as HomeIcon2, HomeIcon, LucideHome } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge, twJoin } from 'tailwind-merge';
import { cva, cx } from 'class-variance-authority';
import { toast, Toaster } from 'sonner';
import { Dialog, Slot, Tabs } from 'radix-ui';
export default function A() {
  useEffect(() => {}, []); const [s] = useState(0);
  console.log(React, createRoot, createPortal, clsx, twMerge, twJoin, cva, cx, toast, Dialog, Slot, Tabs, s);
  return <div><ArrowRight /><HomeIcon2 /><HomeIcon /><LucideHome /><Toaster /></div>;
}`,
    );
    expect(errors).toEqual([]);
  });

  it('checks the recommended libraries too', async () => {
    const libs = {
      dependencies: { ...pkg.dependencies, recharts: '^3', 'react-hook-form': '^7', '@hookform/resolvers': '^5', zod: '^4', 'date-fns': '^4', '@tanstack/react-table': '^8', motion: '^12', zustand: '^5' },
    };
    const good = `import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table';
import { motion } from 'motion/react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
type Row = ColumnDef<unknown>; type S = SubmitHandler<{ a: string }>;
export const A = () => { console.log(useForm, zodResolver, z, format, useReactTable, getCoreRowModel, flexRender, motion, create, persist); return <ResponsiveContainer><LineChart><Line /></LineChart></ResponsiveContainer>; };
export type { Row, S };`;
    expect(await check(good, 'src/A.tsx', libs)).toEqual([]);

    const bad = `import { useState, useForm } from 'react-hook-form';
import { LineGraph } from 'recharts';
import { formatDate2 } from 'date-fns';
export const A = () => { console.log(useState, useForm, formatDate2); return <LineGraph />; };`;
    const errors = await check(bad, 'src/A.tsx', libs);
    expect(errors.map((e) => e.message)).toEqual([
      'react-hook-form has no export "useState": it is exported by "react". Import it from there.',
      expect.stringContaining('recharts has no export "LineGraph".'),
      expect.stringContaining('date-fns has no export "formatDate2".'),
    ]);
    expect(errors[0]).toMatchObject({ file: 'src/A.tsx', line: 1 });
    // a library the project does not declare (or declares in another major) is left alone
    expect(await check(bad)).toEqual([]);
    // the first import of these packages reads a few thousand files from disk
  }, 90_000);

  it('flags removed lucide brand icons with the brand-icons hint and a suggestion', async () => {
    const errors = await check(`import { Github } from 'lucide-react';\nexport const A = () => <Github />;\n`);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: 'src/A.tsx', line: 1, column: 10, lineText: "import { Github } from 'lucide-react';" });
    expect(errors[0]?.message).toBe(
      'lucide-react has no export "Github" (brand icons were removed in lucide v1). Use "@/components/brand-icons" or a generic icon. Did you mean "GitFork"?',
    );
  });

  it('flags every brand icon variant, aliases, multi-line and default+named imports', async () => {
    const errors = await check(
      `import React, { useState } from 'react';
import Lucide, {
  ArrowRight,
  Twitter as Bird, // social
  Instagram,
  FacebookIcon,
  LucideLinkedin,
  Youtube,
} from "lucide-react";
export const A = () => { useState(0); return <div>{String(React)}{String(Lucide)}<ArrowRight /><Bird /><Instagram /><FacebookIcon /><LucideLinkedin /><Youtube /></div>; };
`,
    );
    expect(errors.map((e) => [e.line, /"(\w+)"/.exec(e.message)?.[1]])).toEqual([
      [4, 'Twitter'],
      [5, 'Instagram'],
      [6, 'FacebookIcon'],
      [7, 'LucideLinkedin'],
      [8, 'Youtube'],
    ]);
    for (const e of errors) {
      expect(e.message).toContain('brand icons were removed in lucide v1');
      expect(e.message).toContain('"@/components/brand-icons"');
    }
    expect(errors[0]?.lineText).toBe('  Twitter as Bird, // social');
  });

  it('suggests the closest name for typos in other packages', async () => {
    const errors = await check(
      `import { useStat } from 'react';
import { Sparklez } from 'lucide-react';
import { hydrateRooot } from 'react-dom/client';
import { twMerj } from 'tailwind-merge';
import { toastt } from 'sonner';
import { Dialogg } from 'radix-ui';
import { cvaa } from 'class-variance-authority';
import { clsxx } from 'clsx';
console.log(useStat, Sparklez, hydrateRooot, twMerj, toastt, Dialogg, cvaa, clsxx);
`,
      'src/a.ts',
    );
    expect(errors.map((e) => e.message)).toEqual([
      'react has no export "useStat". Did you mean "useState"?',
      'lucide-react has no export "Sparklez" (this icon does not exist in the installed lucide version). Did you mean "Sparkles"?',
      'react-dom/client has no export "hydrateRooot". Did you mean "hydrateRoot"?',
      'tailwind-merge has no export "twMerj". Did you mean "twMerge"?',
      'sonner has no export "toastt". Did you mean "toast"?',
      'radix-ui has no export "Dialogg". Did you mean "Dialog"?',
      'class-variance-authority has no export "cvaa". Did you mean "cva"?',
      'clsx has no export "clsxx". Did you mean "clsx"?',
    ]);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ignores type-only imports in every form', async () => {
    const errors = await check(
      `import type { LucideIcon, LucideProps } from 'lucide-react';
import type React from 'react';
import { type FC, type ReactNode as Node, useState } from 'react';
import { ComponentProps, HTMLAttributes, PropsWithChildren } from 'react';
import { IconNode } from 'lucide-react';
import { type VariantProps } from 'class-variance-authority';
import { ClassValue } from 'clsx';
import { ExternalToast, ToasterProps } from 'sonner';
export type { LucideIcon as Icon } from 'lucide-react';
type P = PropsWithChildren<HTMLAttributes<HTMLDivElement>> & ComponentProps<'div'> & { icon?: LucideIcon; node?: IconNode; p?: LucideProps; v?: VariantProps<never>; c?: ClassValue; t?: ExternalToast & ToasterProps; n?: Node; r?: React.ReactNode };
export const A: FC<P> = () => { useState(0); return null; };
`,
    );
    expect(errors).toEqual([]);
  });

  it('ignores imports in comments and strings, and namespace / side-effect imports', async () => {
    const errors = await check(
      `// import { Github } from 'lucide-react';
/* import { Twitter } from 'lucide-react'; */
import * as Icons from 'lucide-react';
import 'sonner';
const doc = "import { Facebook } from 'lucide-react'";
export const A = () => <div title={doc}><Icons.ArrowRight /></div>;
`,
    );
    expect(errors).toEqual([]);
  });

  it('validates re-exports', async () => {
    const errors = await check(`export { Youtube, ArrowRight } from 'lucide-react';\n`, 'src/icons.ts');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('"Youtube"');
  });

  it('in plain JS files unused imports still count (the browser links them)', async () => {
    const errors = await check(`import { Github } from 'lucide-react';\nexport const a = 1;\n`, 'src/a.jsx');
    expect(errors).toHaveLength(1);
  });

  it('validates only when the declared major matches the installed one', async () => {
    const code = `import { Github } from 'lucide-react';\nimport { useNope } from 'react';\nexport const A = () => { useNope(); return <Github />; };\n`;
    expect(await check(code, 'src/A.tsx', { dependencies: { 'lucide-react': '^0.460.0', react: '^18.3.1' } })).toEqual([]);
    expect(await check(code, 'src/A.tsx', { dependencies: {} })).toEqual([]);
    expect(await check(code, 'src/A.tsx', null)).toEqual([]);
    expect(await check(code, 'src/A.tsx', { dependencies: { 'lucide-react': 'latest', react: '*' } })).toEqual([]);
    const onlyReact = await check(code, 'src/A.tsx', { dependencies: { 'lucide-react': '^0.460.0', react: '^19.1.0' } });
    expect(onlyReact.map((e) => e.message)).toEqual(['react has no export "useNope".']);
  });

  it('skips files with syntax errors and non-script files', async () => {
    expect(await check(`import { Github } from 'lucide-react';\nexport const A = () => <div>;\n`)).toEqual([]);
    expect(await check(`import { Github } from 'lucide-react';`, 'src/notes.md')).toEqual([]);
  });
});

describe('import parsing helpers', () => {
  it('parses named imports and re-exports', () => {
    expect(parseNamedImports(`import a,{b as c,type d,e}from"x";export{f,g as h}from"y";import*as z from"q";import"side";import k from"k";`)).toEqual([
      { specifier: 'x', name: 'b' },
      { specifier: 'x', name: 'e' },
      { specifier: 'y', name: 'f' },
      { specifier: 'y', name: 'g' },
    ]);
    expect(parseNamedImports(`import type { A } from 'x';\nimport {\n  B,\n  C as D,\n} from 'y'\nimport { default as E, F } from "z";`)).toEqual([
      { specifier: 'y', name: 'B' },
      { specifier: 'y', name: 'C' },
      { specifier: 'z', name: 'F' },
    ]);
  });

  it('masks comments but keeps offsets and strings', () => {
    const src = `a // x 'y'\n/* b\n c */ d "// not a comment" e`;
    const masked = maskComments(src);
    expect(masked.length).toBe(src.length);
    expect(masked.split('\n').length).toBe(src.split('\n').length);
    expect(masked).not.toContain('x');
    expect(masked).not.toContain('b');
    expect(masked).toContain('"// not a comment"');
    expect(masked).toContain('d');
  });

  it('suggests names', () => {
    const names = ['GitFork', 'GitBranch', 'Gift', 'Home', 'HomeIcon', 'LucideHome', 'Sparkles', 'useState', 'useMemo'];
    expect(suggestName('Github', names)).toBe('GitFork');
    expect(suggestName('Hom', names)).toBe('Home');
    expect(suggestName('HomIcon', names)).toBe('HomeIcon');
    expect(suggestName('sparkles', names)).toBe('Sparkles');
    expect(suggestName('Zzzzzzzzzz', names)).toBeNull();
  });
});
