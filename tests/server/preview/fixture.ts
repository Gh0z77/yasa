// A realistic generated project used by the preview pipeline tests (and by .scratch/preview/serve.mts).
import type { ProjectFile } from '../../../shared/types';

export function file(path: string, content: string, encoding: 'utf8' | 'base64' = 'utf8'): ProjectFile {
  const size = encoding === 'base64' ? Buffer.from(content, 'base64').length : Buffer.byteLength(content, 'utf8');
  return { path, content, encoding, size, updatedAt: '2026-01-01T00:00:00.000Z' };
}

/** 1×1 transparent PNG. */
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const APP_ORIGIN = 'http://localhost:3000';

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'yasa-fixture',
    private: true,
    version: '0.0.0',
    type: 'module',
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      'lucide-react': '^1.0.0',
      clsx: '^2.1.1',
      'tailwind-merge': '^3.0.0',
      'class-variance-authority': '^0.7.1',
      'radix-ui': '^1.4.0',
      sonner: '^2.0.0',
      'tw-animate-css': '^1.3.0',
    },
    devDependencies: {
      tailwindcss: '^4.0.0',
      typescript: '^5.8.0',
      vite: '^7.0.0',
    },
  },
  null,
  2,
);

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fixture App</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
`;

const APP_TSX = `import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Sparkles, Zap } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import logo from './assets/logo.png';
import data from './data.json';

interface Feature {
  icon: LucideIcon;
  title: string;
  text: string;
}

const features: Feature[] = [
  { icon: Sparkles, title: 'Beautiful', text: 'Design tokens everywhere.' },
  { icon: Zap, title: 'Fast', text: 'Built in milliseconds.' },
  { icon: ArrowRight, title: 'Simple', text: 'Just describe it.' },
];

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border bg-card p-6 shadow-sm dark:bg-muted', className)}>{children}</div>;
}

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 animate-in fade-in">
      <img src={logo} alt="logo" className="size-8" />
      <h1 data-testid="title" className="text-4xl font-bold tracking-tight md:text-6xl">
        {data.title}
      </h1>
      <p className="mt-4 text-muted-foreground dark:text-foreground">A fixture for the preview pipeline.</p>
      <div className="mt-8 flex items-center gap-4">
        <Button
          data-testid="counter"
          className="px-[13px] hover:bg-primary/90"
          onClick={() => {
            setCount((c) => c + 1);
            toast('Clicked');
          }}
        >
          Count: {count}
        </Button>
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <Button variant="outline" data-testid="open-dialog">
              Open
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50" />
            <Dialog.Content data-testid="dialog" className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-6">
              <Dialog.Title>Hello from Radix</Dialog.Title>
              <Dialog.Description>Shared React instance works.</Dialog.Description>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
      <section className="mt-12 grid gap-6 md:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="[&>svg]:size-6">
            <f.icon />
            <h3 className="mt-2 font-semibold">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.text}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
`;

const BUTTON_TSX = `import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
`;

const UTILS_TS = `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const INDEX_CSS = `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-lg: var(--radius);
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --primary: oklch(0.55 0.22 264);
  --primary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`;

/** Fresh copy of the fixture project (safe to mutate). */
export function fixtureFiles(): ProjectFile[] {
  return [
    file('package.json', PACKAGE_JSON),
    file('index.html', INDEX_HTML),
    file('src/main.tsx', MAIN_TSX),
    file('src/App.tsx', APP_TSX),
    file('src/components/ui/button.tsx', BUTTON_TSX),
    file('src/lib/utils.ts', UTILS_TS),
    file('src/index.css', INDEX_CSS),
    file('src/data.json', JSON.stringify({ title: 'Hello Yasa' })),
    file('src/assets/logo.png', PNG_1X1_BASE64, 'base64'),
    file('public/robots.txt', 'User-agent: *\nAllow: /\n'),
  ];
}

/** Returns a copy of `files` with one file replaced / added. */
export function withFile(files: ProjectFile[], path: string, content: string, encoding: 'utf8' | 'base64' = 'utf8'): ProjectFile[] {
  return [...files.filter((f) => f.path !== path), file(path, content, encoding)];
}
