import * as React from 'react';
import { NavLink, NavLinkProps } from '@remix-run/react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils.ts';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        icon: 'relative border border-input bg-background hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps =
  & React.ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof buttonVariants>
  & {
    asChild?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {children}
        {variant === 'icon' && (
          <span className='absolute top-1/2 left-1/2 size-[max(100%,44px)] -translate-x-1/2 -translate-y-1/2 [@media(pointer:fine)]:hidden' />
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export type ButtonAnchorProps =
  & React.AnchorHTMLAttributes<HTMLAnchorElement>
  & VariantProps<typeof buttonVariants>;

export const ButtonAnchor = React.forwardRef<
  HTMLAnchorElement,
  ButtonAnchorProps
>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <a
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
ButtonAnchor.displayName = 'ButtonAnchor';

export type ButtonNavLinkProps =
  & NavLinkProps
  & VariantProps<typeof buttonVariants>
  & {
    disabled?: boolean;
    children: React.ReactNode;
  };

export const ButtonNavLink = React.forwardRef<
  HTMLAnchorElement,
  ButtonNavLinkProps
>(
  ({ className, variant, size, disabled, children, ...props }, ref) => {
    return (
      <NavLink
        aria-disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }), {
          'pointer-events-none opacity-50': disabled,
        })}
        ref={ref}
        {...props}
      >
        {children}
        {variant === 'icon' && (
          <span className='absolute top-1/2 left-1/2 size-[max(100%,44px)] -translate-x-1/2 -translate-y-1/2 [@media(pointer:fine)]:hidden' />
        )}
      </NavLink>
    );
  },
);
ButtonAnchor.displayName = 'ButtonNavLink';
