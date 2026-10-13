import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const STOPS = ['var(--brand-from)', 'var(--brand-via)', 'var(--brand-to)'];

function accentStyle(index: number, total: number): CSSProperties {
  // One accent word → the full light-to-deep orange sweep; several words → the sweep is spread across them.
  const from = total <= 1 ? STOPS[0] : index === 0 ? STOPS[0] : STOPS[1];
  const to = total <= 1 ? STOPS[2] : index === total - 1 ? STOPS[2] : STOPS[1];
  return {
    backgroundImage: `linear-gradient(100deg, ${from}, ${to})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
  };
}

/** Poster accent: the same heavy face, set in the flat brand orange. */
const POSTER_ACCENT: CSSProperties = { color: 'var(--brand-to)' };

function Word({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <span data-hero-word className={cn('inline-block will-change-transform', className)} style={style}>
      {children}
    </span>
  );
}

/**
 * Hero headline split into words so anime.js can raise them one by one (`[data-hero-word]`).
 * `accent` is painted with the brand gradient, or in flat orange on its own line for `variant="editorial"`
 * (the poster headline of the public site).
 */
export function HeroTitle({
  before,
  accent,
  after,
  className,
  variant = 'gradient',
}: {
  before?: string;
  accent?: string;
  after?: string;
  className?: string;
  variant?: 'gradient' | 'editorial';
}) {
  const editorial = variant === 'editorial';
  const words = (text: string | undefined) => (text ?? '').split(/\s+/).filter(Boolean);
  const accentWords = words(accent);
  // Punctuation that follows the accent ("Aziz, what shall we build") must stay glued to it.
  const glued = /^[,.!?:;»”)]+/.exec(after ?? '')?.[0] ?? '';
  if (glued) after = (after ?? '').slice(glued.length);
  const parts: ReactNode[] = [];
  words(before).forEach((w, i) => parts.push(<Word key={`b${i}`}>{w}</Word>));
  // The poster sets the accent as its own line.
  if (editorial && parts.length > 0 && accentWords.length > 0) parts.push(<br key="br" />);
  accentWords.forEach((w, i) =>
    parts.push(
      <span key={`a${i}`} className="whitespace-nowrap">
        <Word style={editorial ? POSTER_ACCENT : accentStyle(i, accentWords.length)}>{w}</Word>
        {glued && i === accentWords.length - 1 ? <Word>{glued}</Word> : null}
      </span>,
    ),
  );
  words(after).forEach((w, i) => parts.push(<Word key={`c${i}`}>{w}</Word>));

  return (
    <h1
      className={cn(
        'font-extrabold',
        editorial
          ? 'text-[clamp(2.6rem,6.3vw,5.75rem)] leading-[0.98] tracking-[-0.045em]'
          : 'text-balance text-[2.5rem] leading-[1.02] tracking-[-0.04em] sm:text-6xl xl:text-[4.5rem]',
        className,
      )}
    >
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 ? ' ' : null}
        </span>
      ))}
    </h1>
  );
}
