// Deterministic provider for demos and tests: no network, canned but protocol-correct output.
import type { Provider, ProviderEvent, ProviderRequest } from './types';

const MARKER = '{/* yasa:more-sections */}';

function lastUserText(req: ProviderRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m.role === 'user') return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
  }
  return '';
}

function extract(text: string, tag: string): string {
  const m = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(text);
  return m ? m[1].trim() : '';
}

function escapeJsx(text: string): string {
  return text.replace(/[{}<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleFrom(request: string): string {
  const clean = escapeJsx(request).replace(/\[\[mock:[\w-]+\]\]/g, '').trim();
  const words = clean.split(' ').filter(Boolean).slice(0, 6).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'My App';
}

function appSource(title: string, request: string): string {
  const subtitle = escapeJsx(request).replace(/\[\[mock:[\w-]+\]\]/g, '').slice(0, 160) || 'Built with Yasa in demo mode.';
  return `import { useState } from 'react';
import { ArrowRight, Check, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const features = [
  { icon: Sparkles, title: 'Beautiful by default', text: 'Clean typography, generous spacing and a consistent design system.' },
  { icon: Zap, title: 'Fast to iterate', text: 'Describe a change in chat and watch the preview update.' },
  { icon: Check, title: 'Yours to keep', text: 'Download the code or publish it with one click.' },
];

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="font-semibold tracking-tight">${title}</span>
          <Button size="sm" onClick={() => toast.success('Welcome aboard!')}>
            Get started
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 md:py-24">
          <Badge variant="secondary" className="mb-6">Demo mode</Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">${title}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">${subtitle}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => setCount((c) => c + 1)}>
              Clicked {count} times <ArrowRight className="size-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
              See features
            </Button>
          </div>
        </section>

        <section id="features" className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 sm:px-6 md:grid-cols-3 md:pb-24">
          {features.map((feature) => (
            <Card key={feature.title} className="rounded-2xl shadow-sm transition hover:shadow-md">
              <CardHeader>
                <feature.icon className="size-6 text-primary" />
                <CardTitle className="mt-3">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">{feature.text}</CardContent>
            </Card>
          ))}
        </section>
        ${MARKER}
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        Made with Yasa
      </footer>
    </div>
  );
}
`;
}

function sectionSource(name: string, request: string): string {
  const text = escapeJsx(request).slice(0, 200) || 'A new section.';
  return `export function ${name}() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 md:pb-24">
      <div className="rounded-2xl border bg-card p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight">New section</h2>
        <p className="mt-3 text-muted-foreground">${text}</p>
      </div>
    </section>
  );
}
`;
}

function firstTurn(request: string): string {
  const title = titleFrom(request);
  return `Here is what I'll build:

- A landing page for **${title}** with a sticky header
- A hero with a counter button and smooth scrolling
- Three feature cards using the design tokens

<yasa-project name="${title.replace(/"/g, '')}" emoji="🚀" description="${title.replace(/"/g, '')} — a demo app" />
<yasa-title>Build ${title.replace(/[<>]/g, '').slice(0, 40)}</yasa-title>
<yasa-write path="src/App.tsx">
${appSource(title, request)}</yasa-write>

The first version is ready — try the button in the hero. This is demo mode, so replies are pre-written; connect an AI key to build anything you like.

<yasa-suggestions>
Add a pricing section
Add a contact form
Switch to a dark theme
</yasa-suggestions>`;
}

function followUp(request: string, userText: string): string {
  if (!userText.includes(MARKER)) return firstTurn(request);
  const n = (userText.match(/src\/components\/Section\d+\.tsx/g) ?? []).length + 1;
  const name = `Section${n}`;
  const importAnchor = "import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';";
  return `I'll add a new section below the features.

<yasa-title>Add section ${n}</yasa-title>
<yasa-write path="src/components/${name}.tsx">
${sectionSource(name, request)}</yasa-write>
<yasa-edit path="src/App.tsx">
<<<<<<< SEARCH
${importAnchor}
=======
${importAnchor}
import { ${name} } from '@/components/${name}';
>>>>>>> REPLACE
<<<<<<< SEARCH
        ${MARKER}
=======
        <${name} />
        ${MARKER}
>>>>>>> REPLACE
</yasa-edit>

Added a new section under the feature cards.

<yasa-suggestions>
Add another section
Change the headline
</yasa-suggestions>`;
}

function chatReply(request: string): string {
  return `This is **demo mode**, so I can only give a canned answer.

A good plan for "${escapeJsx(request).slice(0, 80)}":

1. Start with the page structure and the main call to action
2. Add the core feature with realistic sample data
3. Polish spacing, states and mobile layout

<yasa-suggestions>
Build this plan
</yasa-suggestions>`;
}

function respond(req: ProviderRequest): string {
  const userText = lastUserText(req);
  const request = extract(userText, 'user_request') || userText.slice(0, 200);
  const isChat = req.system.includes('Chat mode is ON');
  if (isChat) return chatReply(request);

  // Test hooks -----------------------------------------------------------------
  if (userText.includes('<build_errors>')) {
    return `Fixed the syntax error.\n\n<yasa-write path="src/App.tsx">\n${appSource('Fixed App', 'Recovered after a build error.')}</yasa-write>\n\nThe build passes again.`;
  }
  if (userText.includes('<failed_actions>')) {
    return `Re-applying the change with a full rewrite.\n\n<yasa-write path="src/App.tsx">\n${appSource('Reapplied App', 'Recovered after a failed edit.')}</yasa-write>\n\nDone.`;
  }
  if (request.includes('[[mock:build-error]]')) {
    return `Let me update the app.\n\n<yasa-title>Break the build</yasa-title>\n<yasa-write path="src/App.tsx">\nexport default function App() {\n  return <div>broken\n}\n</yasa-write>\n\nDone.`;
  }
  if (request.includes('[[mock:bad-edit]]')) {
    return `Applying a small edit.\n\n<yasa-title>Tweak the app</yasa-title>\n<yasa-edit path="src/App.tsx">\n<<<<<<< SEARCH\nthis text does not exist anywhere\n=======\nreplacement\n>>>>>>> REPLACE\n</yasa-edit>\n\nDone.`;
  }
  if (request.includes('[[mock:questions]]')) {
    return [
      'A couple of quick questions before I build.',
      '',
      '<yasa-questions>',
      '? What style should it have?',
      '- Minimal and clean',
      '- Bold and playful',
      '- Dark and premium',
      '? Which colour palette fits best? [colors]',
      '- Warm sand | #F5E9DA #C98A4B #E8B86D #2A2118',
      '- Deep ocean | #0B132B #1C7293 #5BC0BE #F4F7F5',
      '? Which sections do you need? [multi]',
      '- Pricing',
      '- Testimonials',
      '- Contact form',
      '</yasa-questions>',
    ].join('\n');
  }
  if (request.includes('[[mock:image]]')) {
    return [
      'Adding pictures.',
      '',
      '<yasa-image path="public/images/hero.jpg" prompt="A cozy cafe interior in warm morning light, editorial photo" aspect="16:9" />',
      '<yasa-image path="src/not-allowed.ts" prompt="A picture saved in the wrong place" />',
      '<yasa-write path="src/App.tsx">',
      appSource('Image App', 'With a generated hero.') + '</yasa-write>',
      '',
      'Done.',
    ].join('\n');
  }
  if (request.includes('[[mock:refusal]]')) return '';

  const hasAssistantHistory = req.messages.some((m) => m.role === 'assistant');
  return hasAssistantHistory ? followUp(request, userText) : firstTurn(request);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export const mockProvider: Provider = {
  id: 'mock',

  async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const userText = lastUserText(req);
    const text = respond(req);
    const slow = userText.includes('[[mock:slow]]');
    const delay = process.env.NODE_ENV === 'test' ? (slow ? 15 : 0) : slow ? 60 : 12;
    const inputTokens = Math.round((req.system.length + userText.length) / 4);

    if (userText.includes('[[mock:refusal]]')) {
      yield { type: 'usage', inputTokens, outputTokens: 0 };
      yield { type: 'stop', reason: 'refusal', detail: 'Demo refusal.' };
      return;
    }

    yield { type: 'thinking', delta: 'Planning the layout and components… ' };
    await sleep(delay * 4, req.signal);

    // Uneven chunk sizes exercise the incremental parser.
    let i = 0;
    let emitted = 0;
    while (i < text.length) {
      if (req.signal.aborted) {
        yield { type: 'usage', inputTokens, outputTokens: Math.round(emitted / 4) };
        yield { type: 'stop', reason: 'aborted' };
        return;
      }
      const size = 7 + ((i * 31) % 43);
      const chunk = text.slice(i, i + size);
      i += size;
      emitted += chunk.length;
      yield { type: 'text', delta: chunk };
      await sleep(delay, req.signal);
    }
    yield { type: 'usage', inputTokens, outputTokens: Math.round(text.length / 4) };
    yield { type: 'stop', reason: 'end' };
  },

  async test() {
    // Nothing to verify for the demo provider.
  },
};
