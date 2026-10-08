import type { Question, RoundAnswers } from "allthings-core/src/collab/seal.ts";
import { briefHtml } from "./brief.ts";
import type { Panel, PanelComment, PanelRound, Person } from "./collab.ts";

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

/**
 * The forms a signer who may write sees: where they post, the comment
 * form's token (forms.ts), and the notice after one went in.
 */
export interface PanelForms {
  readonly action: string;
  readonly commentToken: string;
  /** Where a round posts, and its form's token; none without the answers key. */
  readonly roundAction: string;
  readonly roundToken: string | null;
  readonly notice: string | null;
}

/** A round's latest save, opened for the panel (null if it doesn't open), with its review. */
export interface OpenedRound {
  readonly id: string;
  readonly roundId: string;
  readonly stage: "draft" | "final";
  readonly at: string;
  readonly by: string | null;
  readonly decision: string | null;
  readonly note: string | null;
  readonly answers: RoundAnswers | null;
}

const questionTypes = [
  "guess the output",
  "spot the bug",
  "name that error",
  "visual",
  "open",
] as const;
const difficulties = ["gettable", "deep", "brutal"] as const;

const decisions: Readonly<Record<string, string>> = {
  accepted: "accepted",
  rejected: "not taken",
  changes_requested: "changes asked for",
};

const empty: Question = {
  type: null,
  question: "",
  answer: "",
  alsoAccept: "",
  source: "",
  whyFair: "",
  difficulty: null,
};

/** One question's fields, prefilled with what was saved. */
function QuestionFields({
  n,
  label,
  question,
}: {
  readonly n: number;
  readonly label: string;
  readonly question: Question;
}) {
  const text = (name: string, title: string, value: string, max: number) => (
    <label>
      <span class="at-type-meta" safe>
        {title}
      </span>
      <input
        type="text"
        name={`q${n}_${name}`}
        value={value}
        maxlength={String(max)}
      />
    </label>
  );
  return (
    <fieldset class="collab-question">
      <legend class="at-type-meta" safe>
        {label}
      </legend>
      <label>
        <span class="at-type-meta">type</span>
        <select name={`q${n}_type`}>
          <option value="">choose</option>
          {questionTypes.map((type) => (
            <option value={type} selected={question.type === type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span class="at-type-meta">question</span>
        <textarea name={`q${n}_question`} rows="3" maxlength="1000" safe>
          {question.question}
        </textarea>
      </label>
      {text("answer", "answer", question.answer, 500)}
      {text("also", "also accept", question.alsoAccept, 500)}
      {text("source", "source (https)", question.source, 500)}
      {text("fair", "why it's fair", question.whyFair, 300)}
      <label>
        <span class="at-type-meta">difficulty</span>
        <select name={`q${n}_difficulty`}>
          <option value="">choose</option>
          {difficulties.map((difficulty) => (
            <option
              value={difficulty}
              selected={question.difficulty === difficulty}
            >
              {difficulty}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

const savedLine = (saved: OpenedRound) =>
  [
    saved.stage === "final" ? "handed in" : "draft saved",
    commentDay.format(new Date(saved.at)).toLowerCase(),
    ...(saved.by === null ? [] : [`by ${saved.by}`]),
    saved.decision === null
      ? "not reviewed yet"
      : (decisions[saved.decision] ?? saved.decision),
  ].join(" · ");

/** The round a host writes: what was saved and how it was reviewed, then the form. */
function RoundForm({
  round,
  saved,
  forms,
}: {
  readonly round: PanelRound;
  readonly saved: OpenedRound | undefined;
  readonly forms: PanelForms;
}) {
  const answers = saved?.answers ?? null;
  const at = (list: ReadonlyArray<Question> | undefined, i: number) =>
    list?.[i] ?? empty;
  return (
    <>
      {saved === undefined ? (
        <p>Nothing saved yet.</p>
      ) : (
        <p class="at-type-meta" safe>
          {savedLine(saved)}
        </p>
      )}
      {saved?.note == null ? (
        ""
      ) : (
        <p class="collab-comment" safe>
          {saved.note}
        </p>
      )}
      {forms.roundToken === null ? (
        ""
      ) : (
        <form
          class="collab-form collab-round"
          method="post"
          action={forms.roundAction}
        >
          <input type="hidden" name="token" value={forms.roundToken} />
          <input type="hidden" name="round" value={round.id} />
          {Array.from({ length: round.questions }, (_, i) => (
            <QuestionFields
              n={i + 1}
              label={`question ${i + 1}`}
              question={at(answers?.questions, i)}
            />
          ))}
          {Array.from({ length: round.backups }, (_, i) => (
            <QuestionFields
              n={round.questions + i + 1}
              label={`backup ${i + 1}`}
              question={at(answers?.backups, i)}
            />
          ))}
          <div class="collab-actions">
            <button class="button" type="submit" name="stage" value="draft">
              save the draft
            </button>
            <button class="button" type="submit" name="stage" value="final">
              hand it in
            </button>
          </div>
        </form>
      )}
    </>
  );
}

/** A round as the organizers read it here: the latest save, its questions and answers. */
function RoundRead({ saved }: { readonly saved: OpenedRound | undefined }) {
  if (saved === undefined) return <p>Nothing handed in yet.</p>;
  const answers = saved.answers;
  const rows = (list: ReadonlyArray<Question>, label: string) =>
    list.map((q, i) => (
      <li>
        <p class="at-type-meta" safe>
          {`${label} ${i + 1} · ${q.type ?? "no type"} · ${q.difficulty ?? "no difficulty"}`}
        </p>
        <p safe>{q.question}</p>
        <p
          safe
        >{`Answer: ${q.answer}${q.alsoAccept === "" ? "" : ` (also ${q.alsoAccept})`}`}</p>
        <p class="at-type-meta" safe>
          {q.source}
        </p>
      </li>
    ));
  return (
    <>
      <p class="at-type-meta" safe>
        {savedLine(saved)}
      </p>
      {answers === null ? (
        <p>This save doesn't open with the preview's key.</p>
      ) : (
        <details>
          <summary>the questions and answers</summary>
          <ol class="collab-list">
            {rows(answers.questions, "question")}
            {rows(answers.backups, "backup")}
          </ol>
        </details>
      )}
    </>
  );
}

/** Who may comment: everyone but a viewer. */
const writers = new Set(["commenter", "round_host", "venue", "organizer"]);

/** A comment form, on the evening, a brief section or a round. */
function CommentBox({
  forms,
  on,
  label,
}: {
  readonly forms: PanelForms;
  readonly on: string;
  readonly label: string;
}) {
  return (
    <form class="collab-form" method="post" action={forms.action}>
      <input type="hidden" name="token" value={forms.commentToken} />
      <input type="hidden" name="on" value={on} />
      <label>
        <span class="at-type-meta" safe>
          {label}
        </span>
        <textarea name="body" rows="3" maxlength="2000" required></textarea>
      </label>
      <button class="button" type="submit">
        comment
      </button>
    </form>
  );
}

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
export function CollabPanel({
  panel,
  forms,
  opened = [],
}: {
  readonly panel: Panel;
  readonly forms?: PanelForms;
  /** The rounds' latest saves the signer may see, opened. */
  readonly opened?: ReadonlyArray<OpenedRound>;
}) {
  const organizes = panel.roles.includes("organizer");
  const savedFor = (roundId: string) =>
    opened.find((round) => round.roundId === roundId);
  const roundComments = (roundId: string) => (
    <>
      <Comments
        comments={panel.comments.filter((c) => c.roundId === roundId)}
      />
      {forms === undefined ? (
        ""
      ) : (
        <CommentBox
          forms={forms}
          on={`round:${roundId}`}
          label="comment on the round, for its hosts and the organizers"
        />
      )}
    </>
  );
  const writes =
    forms !== undefined && panel.roles.some((role) => writers.has(role));
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
      {forms?.notice == null ? (
        ""
      ) : (
        <output class="collab-notice" safe>
          {forms.notice}
        </output>
      )}
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
        {yourRounds.map((round) => (
          <Fact label={`Your round: ${round.title}`}>
            <div id="collab-round">
              {forms === undefined ? (
                <p>Rounds can't be saved here yet.</p>
              ) : (
                <RoundForm
                  round={round}
                  saved={savedFor(round.id)}
                  forms={forms}
                />
              )}
              {roundComments(round.id)}
            </div>
          </Fact>
        ))}
        {organizes
          ? panel.rounds.map((round) => (
              <Fact label={`Round ${round.position}: ${round.title}`}>
                <>
                  <RoundRead saved={savedFor(round.id)} />
                  {roundComments(round.id)}
                </>
              </Fact>
            ))
          : ""}
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
                {writes && forms !== undefined ? (
                  <CommentBox
                    forms={forms}
                    on={`section:${section.id}`}
                    label="comment on this section"
                  />
                ) : (
                  ""
                )}
              </>
            </Fact>
          );
        })}
        <Fact label="Comments">
          <div id="collab-comments">
            {onEvening.length === 0 ? (
              <p>No comments yet.</p>
            ) : (
              <Comments comments={onEvening} />
            )}
            {writes && forms !== undefined ? (
              <CommentBox
                forms={forms}
                on="evening"
                label="comment on the evening"
              />
            ) : (
              ""
            )}
          </div>
        </Fact>
      </dl>
    </section>
  );
}
