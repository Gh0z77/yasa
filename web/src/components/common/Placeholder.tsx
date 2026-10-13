import { Hammer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from './EmptyState';

/**
 * Temporary stand-in used by the foundation stubs (pages / panels) until the owning feature team replaces them.
 * Not for production UI.
 */
export function Placeholder({ name, className }: { name: string; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-48 w-full items-center justify-center', className)} data-placeholder={name}>
      <EmptyState size="sm" icon={Hammer} title={name} description="Placeholder — implemented by its feature team." />
    </div>
  );
}
