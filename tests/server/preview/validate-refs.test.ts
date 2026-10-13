import { describe, expect, it } from 'vitest';
import { undefinedReferences, validateReferences } from '../../../server/preview/validate-refs';

describe('undefinedReferences', () => {
  it('finds names that are used but never imported or declared', () => {
    const code = `
      import { useState } from 'react';
      export function Pricing({ plans }) {
        const [open, setOpen] = useState(false);
        return plans.map((plan) => cn('card', plan.popular && 'ring', open && 'open', missingHelper(plan)));
      }`;
    expect(undefinedReferences(code).sort()).toEqual(['cn', 'missingHelper']);
  });

  it('accepts every kind of local declaration', () => {
    const code = `
      import Default, { named as alias } from 'x';
      import * as everything from 'y';
      const { a, b: [c, ...rest], d = 1 } = alias;
      let later; var hoisted;
      function declared(param, { nested }, ...others) { return param + nested + others.length + inner(); function inner() { return 1; } }
      class Thing { method(arg) { return arg; } }
      const arrow = (x) => { try { return x; } catch (error) { return error; } };
      for (const item of rest) later = item;
      export default [Default, everything, a, c, d, hoisted, declared, Thing, arrow, later];`;
    expect(undefinedReferences(code)).toEqual([]);
  });

  it('knows browser and language globals, and leaves typeof probes alone', () => {
    const code = `
      const width = window.innerWidth + document.body.clientWidth;
      const id = requestAnimationFrame(() => console.log(Math.max(1, width), JSON.stringify({}), localStorage.length));
      const observer = new IntersectionObserver(() => {});
      const el = new HTMLCanvasElement(); const event = new CustomEvent('x'); const p = new Promise(() => {});
      fetch('/x'); setTimeout(() => {}, 1); structuredClone({});
      const hasGtag = typeof gtag !== 'undefined';
      export { id, observer, el, event, p, hasGtag };`;
    expect(undefinedReferences(code)).toEqual([]);
  });

  it('ignores property names and object keys', () => {
    const code = `const obj = { missing: 1, other() {} }; export const value = obj.missing + obj.other.name;`;
    expect(undefinedReferences(code)).toEqual([]);
  });
});

describe('validateReferences', () => {
  it('reports a missing import in a TSX component with its file and line', async () => {
    const content = [
      "import { Check } from 'lucide-react';",
      'interface Plan { name: string; popular?: boolean }',
      'export function Pricing({ plans }: { plans: Plan[] }) {',
      '  return (',
      '    <div>',
      "      {plans.map((plan) => (<Card key={plan.name} className={cn('p-4', plan.popular && 'ring')}><Check />{plan.name}</Card>))}",
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const errors = await validateReferences([{ path: 'src/components/Pricing.tsx', content }]);
    expect(errors.map((e) => e.message.split('"')[1]).sort()).toEqual(['Card', 'cn']);
    expect(errors[0]).toMatchObject({ file: 'src/components/Pricing.tsx', line: 6 });
  });

  it('passes correct files, type-only names and non-script files', async () => {
    const tsx = [
      "import { useState, type ReactNode } from 'react';",
      "import { cn } from '@/lib/utils';",
      'type Props = { children: ReactNode; tone?: Tone };',
      "type Tone = 'a' | 'b';",
      'enum Size { Small, Large }',
      'export function Box({ children, tone }: Props) {',
      '  const [n, setN] = useState<number>(Size.Small);',
      "  return <div className={cn('box', tone)} onClick={() => setN(n + 1)}>{children}</div>;",
      '}',
    ].join('\n');
    const errors = await validateReferences([
      { path: 'src/Box.tsx', content: tsx },
      { path: 'src/index.css', content: '.box { color: red }' },
      { path: 'src/broken.ts', content: 'const = ;' },
    ]);
    expect(errors).toEqual([]);
  });
});
