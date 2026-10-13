import { memo, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useT } from '@/i18n';
import { cn, copyToClipboard } from '@/lib/utils';

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useT('chat');
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative my-3">
      <pre className="scrollbar-thin overflow-x-auto rounded-xl border border-border bg-muted/60 p-3 font-mono text-[12.5px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
      <button
        type="button"
        aria-label={t('message.copyCode')}
        title={t('message.copyCode')}
        onClick={() => {
          void copyToClipboard(textOf(children)).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-2 top-2 rounded-md border border-border bg-background/90 p-1.5 text-muted-foreground opacity-0 shadow-sm transition hover:text-foreground focus-visible:opacity-100 group-hover/code:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

/** Assistant prose. Raw HTML is not rendered (react-markdown escapes it by default). */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        'min-w-0 break-words text-sm leading-relaxed text-foreground',
        '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1',
        '[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold',
        '[&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_hr]:my-4 [&_hr]:border-border [&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_table]:text-[13px] [&_th]:border-b [&_th]:border-border [&_th]:py-1.5 [&_th]:pr-3 [&_th]:font-medium [&_td]:border-b [&_td]:border-border/60 [&_td]:py-1.5 [&_td]:pr-3',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ children, className: cls }) =>
            cls ? (
              <code className={cls}>{children}</code>
            ) : (
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12.5px]">{children}</code>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
