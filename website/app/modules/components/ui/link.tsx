import * as React from 'react';
import { NavLink, type NavLinkProps } from '@remix-run/react';
import { cn } from '../utils.ts';

export type LinkProps = Omit<NavLinkProps, 'className'> & {
  disabled?: boolean;
  className?: string;
};

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  ({ disabled, className, children, ...props }, ref) => {
    return (
      <NavLink
        prefetch='intent'
        {...props}
        aria-disabled={disabled}
        ref={ref}
        className={cn(
          'inline-flex h-10 items-center justify-center rounded-md px-8 text-sm font-medium shadow transition-colors bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          className,
          {
            'pointer-events-none opacity-50': disabled,
          },
        )}
      >
        {children}
      </NavLink>
    );
  },
);
Link.displayName = 'Link';
