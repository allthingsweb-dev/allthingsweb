import { join } from "node:path";
import {
  createGitHub,
  fetchPullRequest,
  previewDeployment,
  summarize,
  type GitHub,
  type Repo,
} from "./github.ts";
import { renderHeader, withHeader } from "./render.ts";
import { targetsFor } from "./targets.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The a/ mark from the brand kit, inlined for shields.io. */
async function logo(): Promise<string | undefined> {
  const file = Bun.file(
    join(import.meta.dir, "../../../brand/public/mark-night.svg"),
  );
  if (!(await file.exists())) return undefined;
  return `data:image/svg+xml;base64,${Buffer.from(await file.bytes()).toString("base64")}`;
}

async function prNumbers(
  github: GitHub,
  repo: Repo,
  eventName: string,
  payload: object,
) {
  const targets = targetsFor(eventName, payload);
  const base = `/repos/${repo.owner}/${repo.name}`;
  if (targets.kind === "numbers") return targets.numbers;
  if (targets.kind === "commit") {
    const prs = await github.rest<{ number: number; state: string }[]>(
      "GET",
      `${base}/commits/${targets.sha}/pulls`,
    );
    return prs.filter((pr) => pr.state === "open").map((pr) => pr.number);
  }
  const open = await github.rest<{ number: number }[]>(
    "GET",
    `${base}/pulls?state=open&per_page=100`,
  );
  return open.map((pr) => pr.number);
}

async function refresh(
  github: GitHub,
  repo: Repo,
  number: number,
  mark: string | undefined,
): Promise<void> {
  const pr = await fetchPullRequest(github, repo, number);
  const deployment = await previewDeployment(github, repo, pr.headRefOid);
  const body = withHeader(
    pr.body,
    renderHeader(summarize(repo, pr, deployment), mark),
  );
  if (body === (pr.body ?? "")) {
    console.log(`#${number}: header up to date`);
    return;
  }
  await github.rest(
    "PATCH",
    `/repos/${repo.owner}/${repo.name}/pulls/${number}`,
    {
      body,
    },
  );
  console.log(`#${number}: header updated`);
}

async function main(): Promise<void> {
  const [owner, name] = required("GITHUB_REPOSITORY").split("/");
  if (!owner || !name) throw new Error("GITHUB_REPOSITORY must be owner/name");
  const repo = { owner, name };
  const github = createGitHub(required("GITHUB_TOKEN"));
  const eventName = required("GITHUB_EVENT_NAME");
  const payload: object = await Bun.file(required("GITHUB_EVENT_PATH")).json();

  const mark = await logo();
  const numbers = await prNumbers(github, repo, eventName, payload);
  let failed = false;
  for (const number of numbers) {
    try {
      await refresh(github, repo, number, mark);
    } catch (error) {
      failed = true;
      console.error(
        `#${number}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failed) process.exitCode = 1;
}

await main();
