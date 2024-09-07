import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ArrowUpRightIcon, MenuIcon, RssIcon } from 'lucide-react';
import { cn } from './utils';

export function DefaultRightTopNav() {
  return (
    <nav className="ml-auto">
      <Popover>
        <PopoverTrigger className="md:hidden" aria-label="Toggle navigation">
          <MenuIcon className="w-6 h-6" />
        </PopoverTrigger>
        <PopoverContent>
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
        <a
          href="https://discord.gg/B3Sm4b5mfD"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          Discord
          <ArrowUpRightIcon className="md:hidden w-4 h-4 inline-block -mt-1 ml-1 text-muted-foreground" />
        </a>
      </li>
      <li>
        <a
          href="https://lu.ma/allthingsweb"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          Luma Calendar
          <ArrowUpRightIcon className="md:hidden w-4 h-4 inline-block -mt-1 ml-1 text-muted-foreground" />
        </a>
      </li>
      <li>
        <a
          href="https://docs.google.com/forms/d/e/1FAIpQLSexZzRt--RQED3ORe5NabGidKd_I2CEx4qWG1R_jOq6mpGIdA/viewform?usp=sf_link"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          Talk Proposal
          <ArrowUpRightIcon className="md:hidden w-4 h-4 inline-block -mt-1 ml-1 text-muted-foreground" />
        </a>
      </li>
      <li>
        <a
          href="https://www.meetup.com/reactjs-san-francisco"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          React Meetup
          <ArrowUpRightIcon className="md:hidden w-4 h-4 inline-block -mt-1 ml-1 text-muted-foreground" />
        </a>
      </li>
      <li>
        <a
          href="https://www.meetup.com/remix-bay-area"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          Remix Meetup
          <ArrowUpRightIcon className="md:hidden w-4 h-4 inline-block -mt-1 ml-1 text-muted-foreground" />
        </a>
      </li>
      <li>
        <a href="/rss" className="text-sm font-medium hover:underline underline-offset-4">
          RSS
          <RssIcon className="md:hidden w-4 h-4 inline-block -mt-1 ml-1 text-muted-foreground" />
        </a>
      </li>
    </ul>
  );
}
