import { briefHtml } from "./brief.ts";
import type { Panel, PanelComment, Person } from "./collab.ts";

/**
 * The "for collaborators" panel under an evening's page in the draft
 * preview (core/README.md, "Collaborating on a draft"): who you are on the
 * evening and who else is, what you have to do and by when, the brief's
 * sections for you, and the comments. The same ledger as the page above
 * it, in the site's type and layout tokens alone. Every word a
 * collaborator wrote is escaped (`safe`); a brief section is HTML only as
 * brief.ts writes and checks it.
 */

const roleNames: Readonly<Record<string, string>> = {
  viewer: "viewer",
  commenter: "commenter",
  round_host: "round host",
  venue: "venue",
  organizer: "organizer",
};

const roleName = (role: string) => roleNames[role] ?? role;

const day = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** A due date as the meta line reads it: "tue, oct 20". */
export const dueDay = (date: string) =>
  day.format(new Date(`${date}T12:00:00Z`)).toLowerCase();

const commentDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: JSX.Element;
}) {
  return (
    <div class="fact">
      <dt class="at-type-meta" safe>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function Comments({
  comments,
}: {
  readonly comments: ReadonlyArray<PanelComment>;
}) {
  if (comments.length === 0) return "";
  return (
    <ol class="collab-comments">
      {comments.map((comment) => (
        <li>
          <p class="at-type-meta" safe>
            {`${comment.by} · ${commentDay.format(new Date(comment.at)).toLowerCase()}`}
          </p>
          <p class="collab-comment" safe>
            {comment.body}
          </p>
        </li>
      ))}
    </ol>
  );
}

const personLine = (person: Person) =>
  [
    person.name,
    person.round === null
      ? roleName(person.role)
      : `${roleName(person.role)}, round ${person.round}`,
    ...(person.email === null ? [] : [person.email]),
  ].join(" · ");

/** The panel, for `panel`'s signer. */
export function CollabPanel({ panel }: { readonly panel: Panel }) {
  const yourRounds = panel.rounds.filter((round) =>
    panel.hosts.includes(round.id),
  );
  const you = [
    ...(panel.name === null ? [] : [panel.name]),
    panel.roles.map(roleName).join(", "),
  ].join(", ");
  const onEvening = panel.comments.filter(
    (c) => c.sectionId === null && c.roundId === null,
  );
  return (
    <section class="collab" aria-labelledby="collab-title">
      <h2 id="collab-title" class="collab-title">
        for collaborators
      </h2>
      <dl class="ledger">
        <Fact label="You">
          <>
            <p class="fact-head" safe>
              {you}
            </p>
            {yourRounds.map((round) => (
              <p safe>
                {`You write round ${round.position}, ${round.title}: ${round.questions} questions and ${round.backups} backup.`}
              </p>
            ))}
          </>
        </Fact>
        <Fact label="Who else">
          {panel.people.length === 0 ? (
            <p>No one is invited yet.</p>
          ) : (
            <ul class="collab-list">
              {panel.people.map((person) => (
                <li safe>{personLine(person)}</li>
              ))}
            </ul>
          )}
        </Fact>
        {panel.tasks.length === 0 ? (
          ""
        ) : (
          <Fact label="To do">
            <ul class="collab-list">
              {panel.tasks.map((task) => (
                <li class={task.done ? "collab-done" : undefined}>
                  <span class="at-type-meta" safe>
                    {task.dueOn === null
                      ? task.done
                        ? "done"
                        : "any time"
                      : `${task.done ? "done · " : ""}by ${dueDay(task.dueOn)}`}
                  </span>{" "}
                  <span safe>{task.title}</span>
                </li>
              ))}
            </ul>
          </Fact>
        )}
        {panel.brief.map((section) => {
          const safeBody = briefHtml(section.body);
          return (
            <Fact label={section.heading}>
              <>
                <div class="collab-brief">{safeBody}</div>
                <Comments
                  comments={panel.comments.filter(
                    (c) => c.sectionId === section.id,
                  )}
                />
              </>
            </Fact>
          );
        })}
        <Fact label="Comments">
          {onEvening.length === 0 ? (
            <p>No comments yet.</p>
          ) : (
            <Comments comments={onEvening} />
          )}
        </Fact>
      </dl>
    </section>
  );
}
