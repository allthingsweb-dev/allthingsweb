import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ArrowUpRightIcon, MenuIcon } from 'lucide-react';
import { cn } from './utils';
import { Link } from 'react-router';

export function DefaultRightTopNav() {
  return (
    <nav className="ml-auto">
      <Popover>
        <PopoverTrigger className="md:hidden" aria-label="Toggle navigation">
          <MenuIcon className="w-6 h-6" />
        </PopoverTrigger>
        <PopoverContent align="end">
          <LinkList />
        </PopoverContent>
      </Popover>
      <LinkList className="hidden md:flex" />
    </nav>
  );
}

function LinkList({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-col md:flex-row gap-4 md:gap-6', className)}>
      <li>
        <Link to="/about" className="text-sm font-medium hover:underline underline-offset-4">
          About us
        </Link>
      </li>
      <li>
        <Link to="/speakers" className="text-sm font-medium hover:underline underline-offset-4">
          Past speakers
        </Link>
      </li>
      <li>
        <a
          href="https://docs.google.com/forms/d/e/1FAIpQLSexZzRt--RQED3ORe5NabGidKd_I2CEx4qWG1R_jOq6mpGIdA/viewform?usp=sf_link"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          Talk proposal
          <ArrowUpRightIcon className="w-4 h-4 inline-block -mt-1 ml-1 text-muted-foreground" />
        </a>
      </li>
    </ul>
  );
}
