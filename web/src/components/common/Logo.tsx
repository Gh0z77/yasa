import { APP_NAME } from '@shared/constants';
import { cn } from '@/lib/utils';

export interface LogoMarkProps {
  /** Pixel size of the square mark. */
  size?: number;
  className?: string;
  /** Accessible name; omit when the mark sits next to the wordmark. */
  title?: string;
}

/** Brand mark: an orange tile with a bold "Y" (same artwork as /favicon.svg). */
export function LogoMark({ size = 28, className, title }: LogoMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0', className)}
    >
      <rect width="32" height="32" rx="7" fill="#fb6a00" />
      <path d="M8.2 8h4.9l2.9 6.1L18.9 8h4.9l-5.6 10.4V24h-4.4v-5.6L8.2 8Z" fill="#fff" />
    </svg>
  );
}

export interface LogoProps {
  /** Pixel size of the mark; the wordmark scales with it. */
  size?: number;
  /** Show only the mark. */
  iconOnly?: boolean;
  className?: string;
  textClassName?: string;
}

/** Mark + "Yasa" wordmark. Wrap in a `<Link to="/">` where it should navigate. */
export function Logo({ size = 28, iconOnly = false, className, textClassName }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 select-none', className)}>
      <LogoMark size={size} title={iconOnly ? APP_NAME : undefined} />
      {iconOnly ? null : (
        <span
          className={cn('font-display leading-none font-extrabold tracking-[-0.04em] text-foreground', textClassName)}
          style={{ fontSize: Math.round(size * 0.76) }}
        >
          {APP_NAME}
        </span>
      )}
    </span>
  );
}
