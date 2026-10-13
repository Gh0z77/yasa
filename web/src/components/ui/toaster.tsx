import type * as React from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '@/components/common/ThemeProvider';
import { useT } from '@/i18n';

/**
 * App-wide toast host (mounted once in main.tsx). Fire toasts anywhere with `import { toast } from 'sonner'`:
 * `toast.success(t('status.saved'))`, `toast.error(errorMessage(err))`, `toast(msg, { action: { label, onClick } })`.
 */
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const t = useT('common');
  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-right"
      closeButton={false}
      gap={10}
      offset={16}
      mobileOffset={12}
      containerAriaLabel={t('nav.notifications')}
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        error: <CircleAlert className="size-4 text-destructive" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        info: <Info className="size-4 text-info" />,
        loading: <LoaderCircle className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'font-sans !rounded-xl !border-border !bg-popover !text-popover-foreground !shadow-lg',
          title: '!font-medium',
          description: '!text-muted-foreground',
          actionButton: '!rounded-md !bg-primary !text-primary-foreground !font-medium',
          cancelButton: '!rounded-md !bg-secondary !text-secondary-foreground',
          closeButton: '!border-border !bg-popover !text-muted-foreground',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          fontFamily: 'var(--font-sans)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
