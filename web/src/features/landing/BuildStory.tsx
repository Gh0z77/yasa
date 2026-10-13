// Scroll-driven product story for the landing page: the visitor scrolls and watches a prompt being typed,
// sent, turned into files, rendered in the preview and published. One anime.js timeline is scrubbed by the
// scroll position of the (tall) section while its content stays pinned.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, FileCode, Lock, MousePointer2, Sparkles } from 'lucide-react';
import { createScope, createTimeline, onScroll, stagger, utils, type AnimationParams } from 'animejs';
import { LogoMark } from '@/components/common/Logo';
import { useT } from '@/i18n';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

const FILES = ['src/App.tsx', 'src/components/Hero.tsx', 'src/components/Menu.tsx', 'src/styles.css'];
const SITE_URL = 'bodom-coffee.yasa.app';

/** Timeline length in abstract units; the scroll position maps onto it linearly. */
const TOTAL = 10_000;
/** Where each of the five steps starts (and the last one ends). */
const BOUNDS = [0, 2100, 3500, 6100, 8100, TOTAL];

// Decorative "code": indent + coloured bars (width in %, colour).
const CODE: Array<{ indent: number; bars: Array<[number, string]> }> = [
  { indent: 0, bars: [[14, '#d9a066'], [26, '#b9d79b']] },
  { indent: 0, bars: [[10, '#d9a066'], [20, '#e9dcc3'], [12, '#8fb4d9']] },
  { indent: 0, bars: [] },
  { indent: 0, bars: [[18, '#d9a066'], [22, '#e9dcc3']] },
  { indent: 1, bars: [[12, '#d9a066']] },
  { indent: 2, bars: [[16, '#8fb4d9'], [30, '#b9d79b']] },
  { indent: 3, bars: [[22, '#8fb4d9'], [18, '#e9dcc3'], [14, '#b9d79b']] },
  { indent: 3, bars: [[26, '#8fb4d9'], [24, '#b9d79b']] },
  { indent: 3, bars: [[18, '#8fb4d9'], [12, '#e9dcc3']] },
  { indent: 2, bars: [[16, '#8fb4d9']] },
  { indent: 1, bars: [[8, '#d9a066']] },
];

const HAIRLINE = 'border-foreground/[0.11]';
const two = (n: number) => String(n).padStart(2, '0');

type Values = Record<string, number>;

/** Offset of `node` inside `ancestor` in layout pixels (unaffected by transforms, unlike client rects). */
function offsetWithin(node: HTMLElement, ancestor: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  let current: HTMLElement | null = node;
  while (current && current !== ancestor) {
    left += current.offsetLeft;
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return { left, top };
}

export function BuildStory() {
  const t = useT('landing');
  const sectionRef = useRef<HTMLElement>(null);
  // Without motion the section is a normal block showing the finished project and every step as a list.
  const [animated, setAnimated] = useState(false);
  const prompt = t('story.demo.prompt');

  const steps = [
    { title: t('story.step1Title'), text: t('story.step1Text') },
    { title: t('story.step2Title'), text: t('story.step2Text') },
    { title: t('story.step3Title'), text: t('story.step3Text') },
    { title: t('story.step4Title'), text: t('story.step4Text') },
    { title: t('story.step5Title'), text: t('story.step5Text') },
  ];
  const items = [t('story.demo.item1'), t('story.demo.item2'), t('story.demo.item3')];

  useEffect(() => {
    setAnimated(!prefersReducedMotion());
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!animated || !section) return;

    const one = (selector: string) => section.querySelector<HTMLElement>(selector);
    const all = (selector: string) => Array.from(section.querySelectorAll<HTMLElement>(selector));
    const typedEl = one('[data-typed]');

    const scope = createScope({ root: section, mediaQueries: { compact: '(max-width: 767px)' } }).add((self) => {
      const compact = Boolean(self?.matches.compact);
      const typing = { n: 0 };
      let shown = -1;
      const syncTyped = () => {
        const n = Math.round(typing.n);
        if (n === shown || !typedEl) return;
        shown = n;
        typedEl.textContent = prompt.slice(0, n);
      };

      // A low `sync` makes the timeline glide after the scroll position instead of snapping to it.
      const timeline = createTimeline({
        defaults: { ease: 'outQuart', duration: 500 },
        autoplay: onScroll({ target: section, enter: 'top top', leave: 'bottom bottom', sync: 0.3 }),
        onRender: syncTyped,
        onUpdate: syncTyped,
      });

      // Puts the target into its `from` state right away, then tweens it to `to` at `at`.
      const fromTo = (target: HTMLElement | HTMLElement[] | null, from: Values, to: Values, at: number, duration = 500, extra: AnimationParams = {}) => {
        if (!target || (Array.isArray(target) && target.length === 0)) return;
        utils.set(target, from);
        const params: AnimationParams = { duration, ...extra };
        for (const key of Object.keys(to)) params[key] = [from[key] ?? 0, to[key] ?? 0];
        timeline.add(target, params, at);
      };

      // Captions swap and the segmented progress fills; the last segment also pins the length to TOTAL.
      steps.forEach((_, index) => {
        const start = BOUNDS[index] ?? 0;
        const end = BOUNDS[index + 1] ?? TOTAL;
        fromTo(one(`[data-seg="${index}"]`), { scaleX: 0 }, { scaleX: 1 }, start, end - start, { ease: 'linear' });
        if (index > 0) {
          fromTo(one(`[data-step-in="${index}"]`), { opacity: 0, translateY: 22 }, { opacity: 1, translateY: 0 }, start, 520);
        }
        if (index < steps.length - 1) {
          fromTo(one(`[data-step-out="${index}"]`), { opacity: 1, translateY: 0 }, { opacity: 0, translateY: -22 }, end - 320, 320, { ease: 'inQuad' });
        }
      });

      // 1. The prompt is typed.
      fromTo(one('[data-placeholder]'), { opacity: 1 }, { opacity: 0 }, 80, 200);
      fromTo(one('[data-caret]'), { opacity: 0 }, { opacity: 1 }, 80, 160);
      timeline.add(typing, { n: [0, prompt.length], duration: 1650, ease: 'linear' }, 250);

      // 2. Send: the button presses, the text leaves the composer and lands in the chat as a message.
      const send = one('[data-send]');
      if (send) {
        timeline.add(send, { scale: [{ to: 0.86, duration: 220, ease: 'outQuad' }, { to: 1, duration: 460, ease: 'outCubic' }] }, 2250);
      }
      fromTo(one('[data-send-glow]'), { opacity: 0, scale: 0.7 }, { opacity: 0.8, scale: 1.8 }, 2250, 400, { ease: 'outQuad' });
      fromTo(one('[data-send-glow-out]'), { opacity: 1 }, { opacity: 0 }, 2660, 440, { ease: 'outQuad' });
      fromTo(one('[data-typed-wrap]'), { opacity: 1, translateY: 0 }, { opacity: 0, translateY: -12 }, 2420, 360, { ease: 'inOutQuad' });
      fromTo(one('[data-user-bubble]'), { opacity: 0, translateY: 40, scale: 0.96 }, { opacity: 1, translateY: 0, scale: 1 }, 2520, 760);
      fromTo(one('[data-placeholder-back]'), { opacity: 0 }, { opacity: 1 }, 2950, 380);

      // 3. The AI plans, then writes the files while code scrolls into the preview.
      fromTo(one('[data-ai-head]'), { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1 }, 3150, 420);
      fromTo(one('[data-think-in]'), { opacity: 0, translateY: 8 }, { opacity: 1, translateY: 0 }, 3200, 380);
      fromTo(one('[data-think-out]'), { opacity: 1 }, { opacity: 0 }, 3700, 300, { ease: 'inQuad' });
      fromTo(one('[data-empty]'), { opacity: 1 }, { opacity: 0 }, 3740, 480, { ease: 'inOutQuad' });
      fromTo(one('[data-buildbar]'), { scaleX: 0 }, { scaleX: 1 }, 3900, 2100, { ease: 'linear' });
      fromTo(all('[data-code-line]'), { opacity: 0, translateX: -10 }, { opacity: 1, translateX: 0 }, 3950, 380, { delay: stagger(150) });
      all('[data-file]').forEach((row, index) => {
        const at = 3900 + index * 450;
        fromTo(row, { opacity: 0, translateY: 10 }, { opacity: 1, translateY: 0 }, at, 460);
        fromTo(row.querySelector<HTMLElement>('[data-file-spin]'), { opacity: 1 }, { opacity: 0 }, at + 480, 180);
        fromTo(row.querySelector<HTMLElement>('[data-file-check]'), { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1 }, at + 520, 360);
      });

      // 4. The build finishes and the site assembles in the preview.
      fromTo(one('[data-code]'), { opacity: 1 }, { opacity: 0 }, 6150, 420, { ease: 'inOutQuad' });
      fromTo(one('[data-done]'), { opacity: 0, translateY: 8 }, { opacity: 1, translateY: 0 }, 6200, 420);
      if (compact) {
        // One pane at a time on phones: the chat hands over to the preview.
        fromTo(one('[data-pane="chat"]'), { opacity: 1, translateX: 0 }, { opacity: 0, translateX: -20 }, 6020, 360, { ease: 'inQuad' });
        fromTo(one('[data-pane="preview"]'), { opacity: 0, translateX: 20 }, { opacity: 1, translateX: 0 }, 6260, 480);
      }
      fromTo(one('[data-site="nav"]'), { opacity: 0, translateY: -10 }, { opacity: 1, translateY: 0 }, 6480, 520);
      fromTo(one('[data-site="art"]'), { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1 }, 6560, 900, { ease: 'outCubic' });
      fromTo(all('[data-site-line]'), { opacity: 0, translateY: 16 }, { opacity: 1, translateY: 0 }, 6700, 560, { delay: stagger(170) });
      fromTo(all('[data-site-card]'), { opacity: 0, translateY: 14 }, { opacity: 1, translateY: 0 }, 7180, 560, { delay: stagger(170) });

      // 5. Publish: a cursor travels to the button, clicks it, the project goes live.
      const windowEl = one('[data-window]');
      const publish = one('[data-pub]');
      const cursor = one('[data-cursor]');
      if (windowEl && publish && cursor) {
        const target = offsetWithin(publish, windowEl);
        const toX = target.left + publish.offsetWidth / 2 - 4;
        const toY = target.top + publish.offsetHeight / 2 - 2;
        const fromX = windowEl.clientWidth * 0.6;
        const fromY = windowEl.clientHeight * 0.66;
        utils.set(cursor, { opacity: 0, translateX: fromX, translateY: fromY, scale: 1 });
        timeline
          .add(cursor, { opacity: [0, 1], duration: 300, ease: 'outQuad' }, 8200)
          .add(cursor, { translateX: [fromX, toX], translateY: [fromY, toY], duration: 820, ease: 'inOutCubic' }, 8240)
          .add(cursor, { scale: [{ to: 0.82, duration: 130 }, { to: 1, duration: 260 }] }, 9080)
          .add(publish, { scale: [{ to: 0.94, duration: 140, ease: 'outQuad' }, { to: 1, duration: 380, ease: 'outCubic' }] }, 9090);
      }
      fromTo(one('[data-pub-done]'), { opacity: 0 }, { opacity: 1 }, 9220, 320, { ease: 'outQuad' });
      fromTo(one('[data-pub-ring]'), { opacity: 0.7, scale: 1 }, { opacity: 0, scale: 1.7 }, 9220, 620, { ease: 'outQuad' });
      fromTo(one('[data-url-out]'), { opacity: 1, translateY: 0 }, { opacity: 0, translateY: -6 }, 9240, 260, { ease: 'inQuad' });
      fromTo(one('[data-url-in]'), { opacity: 0, translateY: 6 }, { opacity: 1, translateY: 0 }, 9380, 380);
      fromTo(one('[data-cursor-out]'), { opacity: 1 }, { opacity: 0 }, 9420, 320, { ease: 'outQuad' });
      fromTo(one('[data-toast]'), { opacity: 0, translateY: -8, scale: 0.96 }, { opacity: 1, translateY: 0, scale: 1 }, 9460, 480);

      if (import.meta.env.DEV) (window as unknown as { __yasaStory?: unknown }).__yasaStory = timeline;
    });

    // The cursor path depends on the layout; rebuild when the width changes (not on mobile toolbar resizes).
    let width = window.innerWidth;
    let timer = 0;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => scope.refresh(), 220);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
      scope.revert();
      if (typedEl) typedEl.textContent = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated, prompt]);

  return (
    <section id="story" ref={sectionRef} aria-label={t('story.title')} className={cn('relative', animated && 'h-[720vh]')}>
      <div className={cn(animated ? 'sticky top-0 flex h-svh flex-col justify-center overflow-hidden pb-5 pt-[4.75rem] sm:pt-[5.5rem]' : 'py-16 sm:py-24')}>
        <div className="mx-auto grid w-full max-w-[84rem] items-center gap-5 px-5 sm:gap-8 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:px-12">
          {/* Captions */}
          <div className="min-w-0 lg:col-span-4">
            <div className={cn('relative', animated && 'h-[10.25rem] sm:h-[11.5rem] lg:h-[20rem]')}>
              {steps.map((step, index) => (
                <div key={index} data-step-in={index} className={cn(animated ? 'absolute inset-0' : 'mb-10')}>
                  <div data-step-out={index}>
                    <p className="flex items-baseline gap-3">
                      <span className="font-numeral text-[3.25rem] leading-none text-brand sm:text-7xl lg:text-[7.5rem]">
                        {two(index + 1)}
                      </span>
                      <span className="eyebrow text-foreground/45">/ {two(steps.length)}</span>
                      <span className="sr-only">{t('story.stepLabel', { n: index + 1, total: steps.length })}</span>
                    </p>
                    <h3 className="mt-3 text-balance font-display text-2xl font-extrabold leading-[1.04] tracking-[-0.035em] sm:text-3xl lg:mt-6 lg:text-[2.75rem]">
                      {step.title}
                    </h3>
                    <p className={cn('mt-2 text-pretty text-sm leading-relaxed text-foreground/65 sm:text-base lg:mt-4 lg:text-lg', animated && 'line-clamp-2 lg:line-clamp-none')}>
                      {step.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div aria-hidden className={cn('mt-4 grid grid-cols-5 gap-1.5 lg:mt-8 lg:max-w-xs', !animated && 'hidden')}>
              {steps.map((_, index) => (
                <span key={index} className="h-[3px] overflow-hidden rounded-full bg-foreground/[0.14]">
                  <span data-seg={index} className="block h-full origin-left rounded-full bg-brand" />
                </span>
              ))}
            </div>
          </div>

          {/* The product window */}
          <div
            data-window
            aria-hidden
            className={cn(
              'pointer-events-none relative flex w-full select-none flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgb(10_10_10/0.05),0_44px_110px_-48px_rgb(10_10_10/0.42)] lg:col-span-8',
              HAIRLINE,
              animated && 'h-[min(50svh,440px)] md:h-[min(62svh,600px)]',
            )}
          >
            <div className={cn('flex h-11 shrink-0 items-center gap-3 border-b px-3.5', HAIRLINE)}>
              <span className="hidden gap-1.5 sm:flex">
                <i className="size-2.5 rounded-full bg-foreground/15" />
                <i className="size-2.5 rounded-full bg-foreground/15" />
                <i className="size-2.5 rounded-full bg-foreground/15" />
              </span>
              <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-foreground/70 sm:ml-3">
                <LogoMark size={16} />
                <span className="truncate">coffee-shop</span>
              </span>
              <span className="relative ml-auto shrink-0">
                <i data-pub-ring className={cn('absolute inset-0 rounded-md border border-[#fb6a00]', !animated && 'hidden')} />
                <span data-pub className="relative inline-grid h-7 overflow-hidden rounded-md text-[11px] font-medium">
                  <span className="col-start-1 row-start-1 inline-flex items-center justify-center bg-primary px-3 text-primary-foreground">
                    {t('story.demo.publish')}
                  </span>
                  <span data-pub-done className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 bg-[#fb6a00] px-3 text-white">
                    <Check className="size-3" strokeWidth={3} />
                    {t('story.demo.published')}
                  </span>
                </span>
              </span>
            </div>

            <div className="relative grid min-h-0 flex-1 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)]">
              {/* Chat */}
              <div data-pane="chat" className={cn('flex min-h-0 flex-col gap-3 p-3.5 sm:p-4 md:border-r', HAIRLINE, animated && 'absolute inset-0 md:static')}>
                <div className="flex min-h-0 flex-1 flex-col justify-end gap-3.5 overflow-hidden">
                  <p data-user-bubble className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-foreground/[0.09] px-3.5 py-2.5 text-[13px] leading-snug">
                    {prompt}
                  </p>
                  <div className="flex gap-2.5">
                    <span data-ai-head className="shrink-0 pt-0.5">
                      <LogoMark size={22} />
                    </span>
                    <div className="relative min-w-0 flex-1">
                      <div data-think-in className={cn('absolute left-0 top-1', !animated && 'hidden')}>
                        <p data-think-out className="flex items-center gap-2 text-[13px] text-foreground/55">
                          <span className="flex gap-1">
                            <i className="size-1 animate-pulse rounded-full bg-current" />
                            <i className="size-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                            <i className="size-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                          </span>
                          {t('story.demo.thinking')}
                        </p>
                      </div>
                      <ul className="space-y-1.5">
                        {FILES.map((file) => (
                          <li
                            key={file}
                            data-file
                            className={cn('flex items-center gap-2 rounded-lg border bg-foreground/[0.03] px-2.5 py-1.5 font-mono text-[11px]', HAIRLINE)}
                          >
                            <FileCode className="size-3.5 shrink-0 text-foreground/45" strokeWidth={1.5} />
                            <span className="truncate text-foreground/85">{file}</span>
                            <span className="relative ml-auto size-3.5 shrink-0">
                              <i
                                data-file-spin
                                className={cn('absolute inset-0 animate-spin rounded-full border-[1.5px] border-foreground/15 border-t-foreground/70', !animated && 'hidden')}
                              />
                              <span data-file-check className="absolute inset-0 grid place-items-center text-[#fb6a00]">
                                <Check className="size-3.5" strokeWidth={3} />
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p data-done className="mt-2.5 flex items-center gap-1.5 text-xs text-foreground/65">
                        <Sparkles className="size-3.5 shrink-0" strokeWidth={1.5} />
                        <span className="truncate">{t('story.demo.done')}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className={cn('flex shrink-0 items-end gap-2 rounded-xl border bg-foreground/[0.04] p-2.5', HAIRLINE)}>
                  <div className="relative min-h-[3.4rem] min-w-0 flex-1 text-[13px] leading-snug">
                    <span data-placeholder className="absolute inset-0 text-foreground/40">
                      {t('story.demo.placeholder')}
                    </span>
                    <span data-placeholder-back className={cn('absolute inset-0 text-foreground/40', !animated && 'hidden')}>
                      {t('story.demo.placeholder')}
                    </span>
                    <span data-typed-wrap className={cn('relative', !animated && 'hidden')}>
                      <span data-typed />
                      <i data-caret className="ml-px inline-block h-[1.05em] w-[1.5px] translate-y-[2px] animate-pulse bg-foreground" />
                    </span>
                  </div>
                  <span className="relative shrink-0">
                    <i data-send-glow className={cn('absolute inset-0', !animated && 'hidden')}>
                      <i data-send-glow-out className="absolute inset-0 rounded-full bg-[#fb6a00] blur-md" />
                    </i>
                    <span data-send className="relative grid size-8 place-items-center rounded-full bg-[#fb6a00] text-white">
                      <ArrowUp className="size-4" strokeWidth={2.5} />
                    </span>
                  </span>
                </div>
              </div>

              {/* Preview */}
              <div data-pane="preview" className={cn('min-h-0 p-2.5 sm:p-3', animated && 'absolute inset-0 md:static')}>
                <div className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-xl border', HAIRLINE)}>
                  <div className={cn('flex h-8 shrink-0 items-center border-b bg-foreground/[0.03] px-2.5', HAIRLINE)}>
                    <div className="relative mx-auto flex h-5 w-full max-w-[16rem] items-center justify-center overflow-hidden rounded bg-foreground/[0.06] px-2 font-mono text-[10px] text-foreground/70">
                      <span data-url-out className={cn('absolute inset-0 flex items-center justify-center text-foreground/45', !animated && 'hidden')}>
                        {t('story.demo.preview')}
                      </span>
                      <span data-url-in className="flex min-w-0 items-center gap-1.5">
                        <Lock className="size-2.5 shrink-0 text-[#fb6a00]" />
                        <span className="truncate">{SITE_URL}</span>
                      </span>
                    </div>
                  </div>

                  <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f7f1e6] text-[#241c14]">
                    {/* The generated site */}
                    <div className={cn('flex flex-col p-3.5 sm:p-5', animated ? 'h-full' : 'min-h-[19rem]')}>
                      <div data-site="nav" className="flex shrink-0 items-center gap-4 text-[10px] sm:text-[11px]">
                        <span className="font-serif text-sm italic sm:text-base">Bodom</span>
                        <span className="ml-auto hidden gap-4 opacity-60 lg:flex">
                          <span>{t('story.demo.siteMenu')}</span>
                          <span>{t('story.demo.siteAbout')}</span>
                        </span>
                        <span className="ml-auto rounded-full border border-[#241c14]/25 px-2.5 py-1 lg:ml-0">{t('story.demo.siteContact')}</span>
                      </div>

                      <div className="mt-3 grid min-h-0 flex-1 grid-cols-[1.3fr_0.7fr] items-stretch gap-3 sm:mt-4 sm:gap-5">
                        <div className="flex min-w-0 flex-col justify-center">
                          <p data-site-line className="font-serif text-balance text-[1.3rem] italic leading-[1.08] tracking-[-0.01em] sm:text-2xl xl:text-[2rem]">
                            {t('story.demo.siteTitle')}
                          </p>
                          <p data-site-line className="mt-2 line-clamp-3 max-w-[22rem] text-[10px] leading-snug opacity-65 sm:mt-3 sm:text-xs">
                            {t('story.demo.siteText')}
                          </p>
                          <div data-site-line className="mt-3 sm:mt-4">
                            <span className="inline-flex rounded-full bg-[#241c14] px-3 py-1.5 text-[10px] font-medium text-[#f7f1e6] sm:px-3.5 sm:text-[11px]">
                              {t('story.demo.siteCta')}
                            </span>
                          </div>
                        </div>
                        <div data-site="art" className="relative min-h-[6rem] overflow-hidden rounded-lg">
                          <img src="/bg-scene.webp" alt="" decoding="async" className="absolute inset-0 size-full object-cover object-[92%_45%]" />
                        </div>
                      </div>

                      <div className="mt-3 grid shrink-0 grid-cols-3 gap-3 border-t border-[#241c14]/15 pt-2.5 sm:mt-4 sm:gap-5">
                        {items.map((item, index) => (
                          <p key={item} data-site-card className="min-w-0">
                            <span className="block font-mono text-[9px] opacity-45">{two(index + 1)}</span>
                            <span className="mt-0.5 block truncate text-[11px] font-medium sm:text-xs">{item}</span>
                          </p>
                        ))}
                      </div>
                    </div>

                    {/* Code being written (covers the site until the build is done) */}
                    <div data-code className={cn('absolute inset-0 z-10 flex flex-col bg-[#14110d] text-[#cfc6b6]', !animated && 'hidden')}>
                      <div className="h-px shrink-0 bg-white/5">
                        <div data-buildbar className="h-full origin-left bg-[#fb6a00]" />
                      </div>
                      <p className="shrink-0 border-b border-white/[0.06] px-3.5 py-1.5 font-mono text-[10px] text-[#8f8676]">src/App.tsx</p>
                      <div className="min-h-0 flex-1 space-y-2 overflow-hidden p-3.5 sm:space-y-2.5 sm:p-5">
                        {CODE.map((line, index) => (
                          <div key={index} data-code-line className="flex h-1.5 items-center gap-2" style={{ paddingLeft: `${line.indent * 1.1}rem` }}>
                            {line.bars.map(([width, color], bar) => (
                              <i key={bar} className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color, opacity: 0.7 }} />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Empty state before the first message */}
                    <div data-empty className={cn('absolute inset-0 z-20 grid place-items-center bg-[#14110d] px-4 text-center', !animated && 'hidden')}>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8f8676]">{t('story.demo.empty')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Publish confirmation, anchored under the button */}
            <div className="absolute right-3 top-[3.1rem] z-30 max-w-[calc(100%-1.5rem)]">
              <div
                data-toast
                className="flex origin-top-right items-center gap-2.5 rounded-xl border border-white/10 bg-[#1b1711] px-3 py-2.5 text-[#f7f1e6] shadow-[0_22px_50px_-18px_rgb(0_0_0/0.8)]"
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#fb6a00] text-white">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{t('story.demo.live')}</span>
                  <span className="block truncate font-mono text-[10px] text-[#a99f8e]">{SITE_URL}</span>
                </span>
              </div>
            </div>

            <span data-cursor className={cn('absolute left-0 top-0 z-40', !animated && 'hidden')}>
              <span data-cursor-out className="block">
                <MousePointer2 className="size-5 fill-white text-[#1b1710] drop-shadow-[0_3px_6px_rgb(0_0_0/0.5)]" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
