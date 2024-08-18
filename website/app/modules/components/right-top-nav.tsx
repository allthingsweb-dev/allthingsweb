export function DefaultRightTopNav() {
  return (
    <nav className="hidden md:flex ml-auto gap-4 sm:gap-6">
      <a
        href="https://discord.gg/B3Sm4b5mfD"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium hover:underline underline-offset-4"
      >
        Discord
      </a>
      <a
        href="https://docs.google.com/forms/d/e/1FAIpQLSexZzRt--RQED3ORe5NabGidKd_I2CEx4qWG1R_jOq6mpGIdA/viewform?usp=sf_link"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium hover:underline underline-offset-4"
      >
        Talk Proposal
      </a>
      <a
        href="https://www.meetup.com/reactjs-san-francisco"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium hover:underline underline-offset-4"
      >
        React Bay Area
      </a>
      <a
        href="https://www.meetup.com/remix-bay-area"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium hover:underline underline-offset-4"
      >
        Remix Bay Area
      </a>
      <a
        href="/rss"
        className="text-sm font-medium hover:underline underline-offset-4"
      >
        RSS
      </a>
    </nav>
  );
}
