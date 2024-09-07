function getMetaElementContent(name: string): string | null {
  const element = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  return element ? element.content : null;
}

const serverOrigin = getMetaElementContent('x-server-origin') || 'https://allthingsweb.dev';
const appVersion = getMetaElementContent('x-app-version');
const sentryDsn = getMetaElementContent('x-sentry');
const posthogToken = getMetaElementContent('x-posthog');

export const clientEnv = {
  serverOrigin,
  appVersion,
  sentryDsn,
  posthogToken,
};
