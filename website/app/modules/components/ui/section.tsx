import { cva, VariantProps } from 'class-variance-authority';
import { HTMLAttributes } from 'react';
import { cn } from '../utils';

const sectionVariants = cva('flex items-center justify-center w-full', {
  variants: {
    variant: {
      default: 'py-6 md:py-12 lg:py-24',
      big: 'py-16 md:py-24 lg:py-32',
    },
    background: {
      default: '',
      muted: 'bg-muted',
    },
  },
  defaultVariants: {
    variant: 'default',
    background: 'default',
  },
});

export function Section({
  children,
  className,
  variant,
  background,
  ...props
}: HTMLAttributes<HTMLElement> & VariantProps<typeof sectionVariants>) {
  return (
    <section {...props} className={cn(sectionVariants({ variant, background, className }))}>
      {children}
    </section>
  );
}
