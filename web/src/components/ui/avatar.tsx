import type * as React from 'react';
import { Avatar as AvatarPrimitive } from 'radix-ui';
import { cn, hashString, initials } from '@/lib/utils';

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full select-none', className)}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn('aspect-square size-full object-cover', className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn('flex size-full items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

// Pleasant, readable-on-white-text gradient pairs; picked by a hash of the seed.
const AVATAR_GRADIENTS = [
  // Light tints around the brand orange, with a few cool ones so neighbours differ.
  ['#ffe2c7', '#ffb877'],
  ['#ffd9d0', '#ff9d85'],
  ['#fff0c2', '#ffd166'],
  ['#e3e0ff', '#b3a8ff'],
  ['#d9f2e3', '#96d9b2'],
  ['#dcecff', '#9cc6ff'],
  ['#f1e6dc', '#d6bfa8'],
  ['#ffe0ec', '#ffa3c4'],
] as const;

export interface UserAvatarProps extends Omit<React.ComponentProps<typeof AvatarPrimitive.Root>, 'children'> {
  name: string;
  /** Stable seed for the color (user id); falls back to the name. */
  seed?: string;
  src?: string | null;
}

/** Initials on a deterministic gradient (there are no profile pictures in v1). */
export function UserAvatar({ name, seed, src, className, ...props }: UserAvatarProps) {
  const [from, to] = AVATAR_GRADIENTS[hashString(seed ?? name) % AVATAR_GRADIENTS.length]!;
  return (
    <Avatar className={className} {...props}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback
        className="font-semibold text-[#1a1208]"
        style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
        delayMs={src ? 300 : 0}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
