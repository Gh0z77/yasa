// Motion layer built on anime.js v4: page intros, scroll reveals and scroll-linked parallax.
import { useEffect, type DependencyList, type RefObject } from 'react';
import { animate, createScope, createTimeline, onScroll, stagger, utils } from 'animejs';

/** True when the OS asks for reduced motion, or motion was switched off with `localStorage['yasa:motion'] = 'off'`. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (localStorage.getItem('yasa:motion') === 'off') return true;
  } catch {
    /* storage blocked */
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Root = RefObject<HTMLElement | null>;

function markReady(): void {
  document.documentElement.classList.add('motion-ready');
}

/**
 * Scroll reveals for everything inside `root`:
 * - `[data-reveal]` fades and rises when it scrolls into view (`data-reveal="left|right|scale"` for variants);
 * - `[data-reveal-group]` reveals its `[data-reveal-item]` children one after another.
 * Elements are only hidden once the script runs, so content stays visible without JavaScript or motion.
 */
export function useScrollReveal(root: Root, deps: DependencyList = []): void {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    markReady();

    // Viewport entry is detected with IntersectionObserver (it also fires for what is already on screen);
    // anime.js runs the actual animations.
    const pending = new Map<Element, () => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          pending.get(entry.target)?.();
          pending.delete(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );

    const scope = createScope({ root: el }).add(() => {
      const singles = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'));
      for (const node of singles) {
        const variant = node.dataset.reveal;
        const from =
          variant === 'left' ? { translateX: -32, translateY: 0, scale: 1 }
          : variant === 'right' ? { translateX: 32, translateY: 0, scale: 1 }
          : variant === 'scale' ? { translateX: 0, translateY: 20, scale: 0.97 }
          : { translateX: 0, translateY: 26, scale: 1 };
        utils.set(node, { opacity: 0, ...from });
        const animation = animate(node, {
          opacity: [0, 1],
          translateX: [from.translateX, 0],
          translateY: [from.translateY, 0],
          scale: [from.scale, 1],
          duration: 1500,
          ease: 'outQuart',
          autoplay: false,
        });
        pending.set(node, () => animation.play());
        observer.observe(node);
      }

      const groups = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal-group]'));
      for (const group of groups) {
        const items = Array.from(group.querySelectorAll<HTMLElement>('[data-reveal-item]'));
        if (items.length === 0) continue;
        utils.set(items, { opacity: 0, translateY: 28 });
        const animation = animate(items, {
          opacity: [0, 1],
          translateY: [28, 0],
          duration: 1400,
          delay: stagger(130),
          ease: 'outQuart',
          autoplay: false,
        });
        pending.set(group, () => animation.play());
        observer.observe(group);
      }
    });

    return () => {
      observer.disconnect();
      scope.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Hero entrance: `[data-hero="badge"]`, each `[data-hero-word]`, then `[data-hero="sub"]`, `[data-hero="prompt"]`
 * and `[data-hero="note"]`.
 */
export function useHeroIntro(root: Root, deps: DependencyList = []): void {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    markReady();

    const scope = createScope({ root: el }).add(() => {
      const words = el.querySelectorAll('[data-hero-word]');
      // Long, soft entrances: everything eases out over ~1.6s and the words follow each other closely.
      const timeline = createTimeline({ defaults: { ease: 'outQuart', duration: 1600 } });
      if (el.querySelector('[data-hero="badge"]')) {
        timeline.add('[data-hero="badge"]', { opacity: [0, 1], translateY: [14, 0], duration: 1200 }, 100);
      }
      if (words.length > 0) {
        timeline.add(words, { opacity: [0, 1], translateY: [34, 0], delay: stagger(110) }, 260);
      }
      if (el.querySelector('[data-hero="sub"]')) {
        timeline.add('[data-hero="sub"]', { opacity: [0, 1], translateY: [22, 0] }, 900);
      }
      if (el.querySelector('[data-hero="prompt"]')) {
        timeline.add('[data-hero="prompt"]', { opacity: [0, 1], translateY: [26, 0] }, 1150);
      }
      if (el.querySelector('[data-hero="note"]')) {
        timeline.add('[data-hero="note"]', { opacity: [0, 1], duration: 1400, ease: 'outQuad' }, 1600);
      }
    });

    return () => scope.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const playedOnce = new Set<string>();

/**
 * Staggered slide-in for a list of children (sidebar items, cards) on mount.
 * With `onceKey` the entrance plays a single time per page load, so chrome that remounts on every
 * navigation (the sidebar) does not flicker.
 */
export function useStaggerIn(
  root: Root,
  selector: string,
  deps: DependencyList = [],
  from: { x?: number; y?: number } = { x: -18 },
  onceKey?: string,
): void {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    if (onceKey && playedOnce.has(onceKey)) return;
    const scope = createScope({ root: el }).add(() => {
      const nodes = el.querySelectorAll(selector);
      if (nodes.length === 0) return;
      animate(nodes, {
        opacity: [0, 1],
        translateX: [from.x ?? 0, 0],
        translateY: [from.y ?? 0, 0],
        duration: 1200,
        delay: stagger(80, { start: 150 }),
        ease: 'outQuart',
        onComplete: () => {
          if (onceKey) playedOnce.add(onceKey);
        },
      });
    });
    return () => scope.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Background motion: the colour clouds (`[data-scene="cloud"]`) drift and breathe very slowly. */
export function useSceneMotion(root: Root): void {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;

    const scope = createScope({ root: el }).add(() => {
      el.querySelectorAll<HTMLElement>('[data-scene="cloud"]').forEach((cloud, index) => {
        animate(cloud, {
          translateX: [0, index % 2 === 0 ? 46 : -38],
          translateY: [0, index % 2 === 0 ? -30 : 34],
          scale: [1, 1.08],
          duration: 11000 + index * 2600,
          ease: 'inOutSine',
          loop: true,
          alternate: true,
        });
      });
    });

    return () => scope.revert();
  }, [root]);
}

/** Pointer-follow glow + tilt for a hero card (the prompt box). Cheap: one animation per pointer move frame. */
export function usePointerGlow(root: Root): void {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion() || window.matchMedia('(pointer: coarse)').matches) return;
    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--glow-x', `${event.clientX - rect.left}px`);
      el.style.setProperty('--glow-y', `${event.clientY - rect.top}px`);
    };
    el.addEventListener('pointermove', onMove);
    return () => el.removeEventListener('pointermove', onMove);
  }, [root]);
}

/** Small press feedback used by primary buttons. */
export function pulse(target: Element | null): void {
  if (!target || prefersReducedMotion()) return;
  animate(target, { scale: [{ to: 0.92, duration: 90 }, { to: 1, duration: 420, ease: 'outElastic(1, .5)' }] });
}
