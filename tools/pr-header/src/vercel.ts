export type VercelConfig = {
  token: string;
  teamId: string;
  projectId: string;
};

/** Each PR's previews live at one stable address, whatever the deployment. */
export function previewAlias(prNumber: number): string {
  return `allthings-pr-${prNumber}.vercel.app`;
}

/** Vercel's JSON response, unvalidated: callers check each field they use. */
async function call(
  config: VercelConfig,
  method: "GET" | "POST",
  path: string,
  fetchImpl: typeof fetch,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set("teamId", config.teamId);
  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 404) return { status: 404, data: null };
  if (!response.ok) {
    throw new Error(
      `Vercel ${method} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  return { status: response.status, data: await response.json() };
}

/** `value[key]` if `value` is an object with a string there, else undefined. */
function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

/** Points the PR's alias at a deployment, given its *.vercel.app URL. */
export async function assignPreviewAlias(
  config: VercelConfig,
  deploymentUrl: string,
  alias: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const host = new URL(deploymentUrl).host;
  const { data } = await call(
    config,
    "GET",
    `/v13/deployments/${host}`,
    fetchImpl,
  );
  const id = stringField(data, "id");
  if (id === undefined || stringField(data, "projectId") !== config.projectId) {
    throw new Error(`${host} is not a deployment of this project`);
  }
  await call(config, "POST", `/v2/deployments/${id}/aliases`, fetchImpl, {
    alias,
  });
}

/**
 * The alias's URL, but only once it points at the given deployment of this
 * project; otherwise null, so the header never links an older preview.
 */
export async function stablePreviewUrl(
  config: VercelConfig,
  alias: string,
  deploymentUrl: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!deploymentUrl) return null;
  const [deployment, target] = await Promise.all([
    call(
      config,
      "GET",
      `/v13/deployments/${new URL(deploymentUrl).host}`,
      fetchImpl,
    ),
    call(config, "GET", `/v4/aliases/${alias}`, fetchImpl),
  ]);
  const deploymentId = stringField(deployment.data, "id");
  const current =
    deploymentId !== undefined &&
    stringField(target.data, "projectId") === config.projectId &&
    stringField(target.data, "deploymentId") === deploymentId;
  return current ? `https://${alias}` : null;
}
