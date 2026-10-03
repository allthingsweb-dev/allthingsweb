export type VercelConfig = {
  token: string;
  teamId: string;
  projectId: string;
};

/** Each PR's previews live at one stable address, whatever the deployment. */
export function previewAlias(prNumber: number): string {
  return `allthings-pr-${prNumber}.vercel.app`;
}

async function call<T>(
  config: VercelConfig,
  method: "GET" | "POST",
  path: string,
  fetchImpl: typeof fetch,
  body?: unknown,
): Promise<{ status: number; data: T | null }> {
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
  return { status: response.status, data: (await response.json()) as T };
}

/** Points the PR's alias at a deployment, given its *.vercel.app URL. */
export async function assignPreviewAlias(
  config: VercelConfig,
  deploymentUrl: string,
  alias: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const host = new URL(deploymentUrl).host;
  const { data } = await call<{ id: string; projectId: string }>(
    config,
    "GET",
    `/v13/deployments/${host}`,
    fetchImpl,
  );
  if (!data || data.projectId !== config.projectId) {
    throw new Error(`${host} is not a deployment of this project`);
  }
  await call(config, "POST", `/v2/deployments/${data.id}/aliases`, fetchImpl, {
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
    call<{ id: string }>(
      config,
      "GET",
      `/v13/deployments/${new URL(deploymentUrl).host}`,
      fetchImpl,
    ),
    call<{ projectId: string; deploymentId: string }>(
      config,
      "GET",
      `/v4/aliases/${alias}`,
      fetchImpl,
    ),
  ]);
  const current =
    target.data?.projectId === config.projectId &&
    deployment.data !== null &&
    target.data.deploymentId === deployment.data.id;
  return current ? `https://${alias}` : null;
}
