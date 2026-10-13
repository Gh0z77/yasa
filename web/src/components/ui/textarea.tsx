import * as React from 'react';
import { cn } from '@/lib/utils';
import { fieldClasses } from './input';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** Grow with the content (between `minRows` and `maxRows`). */
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
  /** Drop the border/background/shadow — for composers that provide their own frame. */
  unstyled?: boolean;
}

function resize(el: HTMLTextAreaElement, minRows: number, maxRows: number): void {
  const style = window.getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 20;
  const extra =
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom) +
    Number.parseFloat(style.borderTopWidth) +
    Number.parseFloat(style.borderBottomWidth);
  const min = lineHeight * minRows + extra;
  const max = lineHeight * maxRows + extra;
  el.style.height = 'auto';
  const border = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
  const wanted = el.scrollHeight + border;
  const next = Math.min(Math.max(wanted, min), max);
  el.style.height = `${next}px`;
  el.style.overflowY = wanted > max + 1 ? 'auto' : 'hidden';
}

export function Textarea({
  className,
  autosize = false,
  minRows = 1,
  maxRows = 10,
  unstyled = false,
  ref,
  value,
  onInput,
  rows,
  ...props
}: TextareaProps) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const setRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<HTMLTextAreaElement | null>).current = node;
    },
    [ref],
  );

  // Controlled value changes (including programmatic resets) re-measure before paint.
  React.useLayoutEffect(() => {
    if (autosize && innerRef.current) resize(innerRef.current, minRows, maxRows);
  }, [autosize, value, minRows, maxRows]);

  // Width changes re-wrap the text.
  React.useEffect(() => {
    const el = innerRef.current;
    if (!autosize || !el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        resize(el, minRows, maxRows);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autosize, minRows, maxRows]);

  return (
    <textarea
      ref={setRef}
      data-slot="textarea"
      value={value}
      rows={autosize ? minRows : rows}
      onInput={(e) => {
        if (autosize) resize(e.currentTarget, minRows, maxRows);
        onInput?.(e);
      }}
      className={cn(
        unstyled
          ? 'w-full min-w-0 resize-none border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground/80 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50'
          : cn(fieldClasses, 'min-h-16 px-3 py-2 text-sm leading-relaxed'),
        autosize && 'min-h-0 resize-none',
        className,
      )}
      {...props}
    />
  );
}
