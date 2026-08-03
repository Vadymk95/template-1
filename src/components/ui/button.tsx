import { Slot } from '@radix-ui/react-slot';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// `outline-hidden`, never `outline-none`: this is accessibility, not a rename. Compiled from the
// installed Tailwind — `outline-hidden` emits `outline-style: none` PLUS
// `@media (forced-colors: active) { outline: 2px solid transparent; outline-offset: 2px }`, while
// `outline-none` emits only the first. The focus ring here is a `box-shadow`, which forced-colors
// suppresses entirely, so with `outline-none` a Windows high-contrast user gets NO focus indicator at
// all (WCAG 2.4.7). Pinned by `focus-indicator.test.tsx`.
const buttonVariants = cva(
    'inline-flex items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default: 'bg-primary text-primary-foreground hover:bg-primary/90',
                secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
                outline:
                    'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
                ghost: 'hover:bg-accent hover:text-accent-foreground',
                link: 'text-primary underline-offset-4 hover:underline'
            },
            size: {
                default: 'h-10 px-4 py-2',
                sm: 'h-9 rounded-md px-3',
                lg: 'h-11 rounded-md px-8',
                icon: 'size-10'
            }
        },
        defaultVariants: {
            variant: 'default',
            size: 'default'
        }
    }
);

interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    asChild?: boolean;
    ref?: React.Ref<HTMLButtonElement>;
}

// React 19: ref passed as regular prop — forwardRef is deprecated
export function Button({ className, variant, size, asChild = false, ref, ...props }: ButtonProps) {
    const Comp = asChild ? Slot : 'button';
    return (
        <Comp
            className={cn(buttonVariants({ variant, size, className }))}
            data-slot="button"
            ref={ref}
            {...props}
        />
    );
}
