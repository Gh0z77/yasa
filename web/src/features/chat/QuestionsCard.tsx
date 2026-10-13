import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import type { ChatQuestion } from '@shared/types';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * The questions the AI asks before it builds: pick an option per question (several for "multi", a palette
 * for "colors"), optionally add a note, then send. The answers go back as an ordinary chat message.
 */
export function QuestionsCard({ items, active, onAnswer }: { items: ChatQuestion[]; active: boolean; onAnswer?(text: string): void }) {
  const t = useT('chat');
  const [picked, setPicked] = useState<number[][]>(() => items.map(() => []));
  const [note, setNote] = useState('');
  const enabled = active && Boolean(onAnswer);

  const toggle = (question: number, option: number) => {
    setPicked((current) =>
      current.map((selection, index) => {
        if (index !== question) return selection;
        if (items[question]?.kind === 'multi') return selection.includes(option) ? selection.filter((o) => o !== option) : [...selection, option];
        return selection[0] === option ? [] : [option];
      }),
    );
  };

  const answered = picked.some((selection) => selection.length > 0) || note.trim().length > 0;

  const submit = () => {
    const lines = items
      .map((question, index) => {
        const chosen = (picked[index] ?? []).map((o) => question.options[o]).filter(Boolean);
        if (chosen.length === 0) return null;
        const labels = chosen.map((option) => (option!.colors?.length ? `${option!.label} (${option!.colors.join(' ')})` : option!.label));
        return `- ${question.text} ${labels.join(', ')}`;
      })
      .filter(Boolean);
    const extra = note.trim();
    onAnswer?.([t('questions.answersIntro'), ...lines, extra ? `- ${extra}` : null].filter(Boolean).join('\n'));
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-3.5">
      {items.map((question, questionIndex) => (
        <fieldset key={questionIndex} disabled={!enabled} className="min-w-0">
          <legend className="text-[13px] font-medium">
            {question.text}
            {question.kind === 'multi' ? <span className="ml-1.5 font-normal text-muted-foreground">{t('questions.multiple')}</span> : null}
          </legend>
          <div className={cn('mt-2 gap-1.5', question.kind === 'colors' ? 'grid sm:grid-cols-2' : 'flex flex-wrap')}>
            {question.options.map((option, optionIndex) => {
              const selected = picked[questionIndex]?.includes(optionIndex) ?? false;
              return (
                <button
                  key={optionIndex}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(questionIndex, optionIndex)}
                  className={cn(
                    'flex max-w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-[12.5px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:cursor-default',
                    selected ? 'border-foreground/60 bg-foreground/[0.08] text-foreground' : 'border-border bg-background text-foreground/80 enabled:hover:border-foreground/30',
                    !enabled && !selected && 'opacity-60',
                  )}
                >
                  {option.colors?.length ? (
                    <span aria-hidden className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-black/10">
                      {option.colors.map((color, index) => (
                        <span key={index} className="h-5 w-3.5" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 break-words">{option.label}</span>
                  {selected ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {enabled ? (
        <>
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && answered) submit();
            }}
            placeholder={t('questions.notePlaceholder')}
            aria-label={t('questions.notePlaceholder')}
            className="h-9 w-full rounded-xl border border-input bg-background px-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onAnswer?.(t('questions.skipMessage'))}
              className="rounded-sm text-[12.5px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45"
            >
              {t('questions.skip')}
            </button>
            <Button type="button" size="sm" disabled={!answered} onClick={submit}>
              {t('questions.submit')}
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
