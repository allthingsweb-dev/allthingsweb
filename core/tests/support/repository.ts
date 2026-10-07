/** The repository's root. */
export const root = new URL("../../../", import.meta.url).pathname;

/** Every file in the repository, tracked or new, that git doesn't ignore. */
export const repositoryFiles = (): ReadonlyArray<string> => {
  const listed = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
  );
  if (listed.exitCode !== 0) throw new Error(listed.stderr.toString());
  return listed.stdout
    .toString()
    .split("\n")
    .filter((path) => path !== "");
};
