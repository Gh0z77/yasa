import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface Dot {
  /** Resting position, in CSS pixels. */
  x: number;
  y: number;
  /** Where the dot starts before the picture assembles. */
  sx: number;
  sy: number;
  size: number;
  alpha: number;
  delay: number;
}

/** Deterministic pseudo-random numbers, so the picture is the same on every render. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Samples a word drawn in the display face into a field of dots. */
function wordDots(text: string, width: number, height: number): Dot[] {
  const probe = document.createElement('canvas');
  probe.width = Math.max(1, Math.round(width));
  probe.height = Math.max(1, Math.round(height));
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  const family = '"Bricolage Grotesque Variable", "Inter Variable", Arial, sans-serif';
  let size = height * 0.98;
  ctx.font = `800 ${size}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (measured > width * 0.98) size *= (width * 0.98) / measured;
  ctx.font = `800 ${size}px ${family}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#000';
  ctx.fillText(text, 0, height / 2 + size * 0.03);
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;

  const random = seeded(11);
  const step = Math.max(2.5, size / 74);
  const dots: Dot[] = [];
  for (let y = 0; y < probe.height; y += step) {
    for (let x = 0; x < probe.width; x += step) {
      if ((data[(y * probe.width + x) * 4 + 3] ?? 0) < 120) continue;
      // A grainy, hand-stippled fill rather than a clean halftone.
      if (random() < 0.34) continue;
      dots.push({
        x: x + (random() - 0.5) * step * 0.9,
        y: y + (random() - 0.5) * step * 0.9,
        sx: x + (random() - 0.5) * width * 0.5,
        sy: y + (random() - 0.5) * height * 2.2,
        size: Math.max(1.1, step * (0.36 + random() * 0.34)),
        alpha: 0.45 + random() * 0.55,
        delay: random() * 0.45,
      });
    }
  }
  return dots;
}

interface SpherePoint {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** Points on a ball, gathered into a few denser clusters so it reads as a map of activity, not a mesh. */
function spherePoints(count: number): SpherePoint[] {
  const random = seeded(29);
  const centres = Array.from({ length: 7 }, () => {
    const u = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    return { x: r * Math.cos(a), y: u, z: r * Math.sin(a) };
  });
  const points: SpherePoint[] = [];
  while (points.length < count) {
    const u = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const p = { x: r * Math.cos(a), y: u, z: r * Math.sin(a) };
    const near = centres.reduce((best, c) => Math.max(best, p.x * c.x + p.y * c.y + p.z * c.z), -1);
    // Keep every point near a cluster, and a thin scatter of the rest.
    if (random() > 0.1 + Math.max(0, near - 0.74) * 3.6) continue;
    const depth = 0.72 + random() * 0.28;
    points.push({ x: p.x * depth, y: p.y * depth, z: p.z * depth, size: 0.9 + random() * 1.1 });
  }
  return points;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Decorative canvas drawn in dots of the brand colour: a word that assembles from scattered points when it
 * scrolls into view (`variant="word"`), or a slowly turning ball of points (`variant="sphere"`).
 */
export function DotArt({ variant, text = '', className }: { variant: 'word' | 'sphere'; text?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = prefersReducedMotion();
    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    const sphere = variant === 'sphere' ? spherePoints(3400) : [];
    let color = '#fb6a00';
    let frame = 0;
    let visible = false;
    let startedAt = 0;
    let assembled = still;
    let disposed = false;

    const readColor = () => {
      color = getComputedStyle(document.documentElement).getPropertyValue('--brand-to').trim() || '#fb6a00';
    };

    const drawWord = (progress: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      for (const dot of dots) {
        const local = Math.min(1, Math.max(0, (progress - dot.delay) / 0.55));
        const k = easeOut(local);
        ctx.globalAlpha = dot.alpha * (0.12 + 0.88 * k);
        ctx.fillRect(dot.sx + (dot.x - dot.sx) * k, dot.sy + (dot.y - dot.sy) * k, dot.size, dot.size);
      }
      ctx.globalAlpha = 1;
    };

    const drawSphere = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      const radius = Math.min(width, height) * 0.46;
      const angle = time * 0.00012;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (const p of sphere) {
        const x = p.x * cos + p.z * sin;
        const z = p.z * cos - p.x * sin;
        ctx.globalAlpha = 0.22 + 0.7 * ((z + 1) / 2);
        const s = p.size * (0.8 + 0.5 * ((z + 1) / 2));
        ctx.fillRect(width / 2 + x * radius, height / 2 + p.y * radius, s, s);
      }
      ctx.globalAlpha = 1;
    };

    const tick = (time: number) => {
      frame = 0;
      if (disposed || !visible) return;
      if (variant === 'sphere') {
        drawSphere(time);
        if (!still) frame = requestAnimationFrame(tick);
        return;
      }
      if (!startedAt) startedAt = time;
      const progress = Math.min(1, (time - startedAt) / 2400);
      drawWord(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else assembled = true;
    };

    const schedule = () => {
      if (!frame && visible && !disposed) frame = requestAnimationFrame(tick);
    };

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readColor();
      if (variant === 'word') {
        dots = wordDots(text, width, height);
        drawWord(assembled ? 1 : 0);
      } else {
        drawSphere(0);
      }
      if (variant === 'sphere' || !assembled) schedule();
    };

    const resize = new ResizeObserver(layout);
    resize.observe(canvas);
    const inView = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible && (variant === 'sphere' || !assembled)) schedule();
      },
      { threshold: 0.2 },
    );
    inView.observe(canvas);
    // The word must be sampled in the display face, which may still be loading.
    void document.fonts?.ready.then(() => {
      if (!disposed) layout();
    });
    // Theme switches change the brand colour.
    const theme = new MutationObserver(() => {
      readColor();
      if (variant === 'word') drawWord(assembled ? 1 : 0);
      else drawSphere(performance.now());
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      inView.disconnect();
      theme.disconnect();
    };
  }, [variant, text]);

  return <canvas ref={ref} aria-hidden className={cn('block size-full', className)} />;
}
