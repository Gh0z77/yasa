import { useState, type ReactNode } from 'react';
import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { overlayClasses } from '@/components/ui/dialog';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Defaults to "Are you sure?". */
  title?: ReactNode;
  /** Defaults to "This action cannot be undone." Pass `null` to hide. */
  description?: ReactNode | null;
  /** Defaults to "Confirm" ("Delete" when `destructive`). */
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  destructive?: boolean;
  /**
   * Called when the user confirms. If it returns a promise (e.g. `mutation.mutateAsync(...)`) the dialog shows a
   * spinner until it settles, closes when it resolves and stays open when it rejects (toast the error yourself).
   * If it returns nothing the dialog closes immediately.
   */
  onConfirm: () => void | Promise<unknown>;
  /** Force the busy state from outside (buttons disabled, spinner on confirm). */
  loading?: boolean;
  /** Extra content between the description and the buttons. */
  children?: ReactNode;
}

/** Modal confirmation built on Radix AlertDialog (focus starts on Cancel, Esc cancels). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  loading = false,
  children,
}: ConfirmDialogProps) {
  const t = useT('common');
  const [pending, setPending] = useState(false);
  const busy = pending || loading;

  const handleConfirm = async () => {
    let result: void | Promise<unknown>;
    try {
      result = onConfirm();
    } catch {
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setPending(true);
      try {
        await result;
        onOpenChange(false);
      } catch {
        /* keep the dialog open; the caller reports the error */
      } finally {
        setPending(false);
      }
    } else {
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClasses} />
        <AlertDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5',
            'rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-xl outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150',
          )}
        >
          <div className="flex flex-col gap-1.5">
            <AlertDialog.Title className="text-lg leading-snug font-semibold tracking-tight">
              {title ?? t('confirm.title')}
            </AlertDialog.Title>
            {description === null ? (
              <AlertDialog.Description className="sr-only">{t('confirm.title')}</AlertDialog.Description>
            ) : (
              <AlertDialog.Description className="text-sm leading-relaxed text-muted-foreground">
                {description ?? t('confirm.description')}
              </AlertDialog.Description>
            )}
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                {cancelLabel ?? t('actions.cancel')}
              </Button>
            </AlertDialog.Cancel>
            <Button variant={destructive ? 'destructive' : 'default'} loading={busy} onClick={() => void handleConfirm()}>
              {confirmLabel ?? (destructive ? t('actions.delete') : t('actions.confirm'))}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
