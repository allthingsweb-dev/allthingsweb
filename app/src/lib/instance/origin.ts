type OriginEnv = {
  origin?: string;
  port: number;
  vercelEnv?: string;
  vercelUrl?: string;
  vercelProjectProductionUrl?: string;
};

/**
 * Resolves the public origin used for canonical URLs, social images, feeds and
 * robots.txt. Production must advertise the project's production domain:
 * `VERCEL_URL` is the per-deployment hostname, which sits behind Vercel
 * Deployment Protection and cannot be fetched by crawlers or link unfurlers.
 */
export function resolveOrigin(env: OriginEnv): string {
  if (env.vercelEnv === "production" && env.vercelProjectProductionUrl) {
    return `https://${env.vercelProjectProductionUrl}`;
  }

  if (env.vercelUrl) {
    return `https://${env.vercelUrl}`;
  }

  if (env.origin) {
    return env.origin;
  }

  return `http://localhost:${env.port}`;
}
