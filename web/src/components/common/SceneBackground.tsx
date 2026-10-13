import { useRef } from 'react';
import { useSceneMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Fixed page backdrop: the plain page colour with a few soft colour clouds (orange, peach, a hint of violet)
 * that drift slowly. Motion is driven by anime.js (see `useSceneMotion`).
 */
export function SceneBackground({ className, dim = false }: { className?: string; dim?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSceneMotion(ref);

  return (
    <div ref={ref} aria-hidden className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background', className)}>
      <div
        data-scene="cloud"
        className="absolute -left-[12%] top-[38%] h-[62%] w-[52%] rounded-full blur-[90px]"
        style={{ backgroundImage: 'radial-gradient(closest-side, var(--blob-a), transparent)' }}
      />
      <div
        data-scene="cloud"
        className="absolute -left-[8%] top-[18%] h-[46%] w-[34%] rounded-full blur-[100px]"
        style={{ backgroundImage: 'radial-gradient(closest-side, var(--blob-b), transparent)' }}
      />
      <div
        data-scene="cloud"
        className="absolute left-[24%] top-[46%] h-[44%] w-[36%] rounded-full blur-[90px]"
        style={{ backgroundImage: 'radial-gradient(closest-side, var(--blob-c), transparent)' }}
      />
      <div
        data-scene="cloud"
        className="absolute -right-[10%] bottom-[-18%] h-[48%] w-[40%] rounded-full blur-[110px]"
        style={{ backgroundImage: 'radial-gradient(closest-side, var(--blob-c), transparent)' }}
      />
      {dim ? <div className="absolute inset-0 bg-background/40" /> : null}
    </div>
  );
}
