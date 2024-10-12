import { createCookieSessionStorageFactory, redirect } from '@remix-run/server-runtime';
import { env } from '~/modules/env.server.ts';
import { createCsrfToken } from './csrf.server.ts';

const { commitSession, getSession } = createCookieSessionStorageFactory({
  cookie: {
    name: 'session',
    secure: true,
    secrets: [env.sessionSecret],
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
  },
});

export async function createUserSession(
  headers = new Headers(),
): Promise<[UserSession, Headers]> {
  const cookie = await getSession();

  const csrfToken = createCsrfToken();
  cookie.set('csrfToken', csrfToken);

  const cookieValue = await commitSession(cookie);
  headers.set('Set-Cookie', cookieValue);

  return [{ csrfToken }, headers];
}

export type UserSession = {
  csrfToken: string;
};

export async function getUserSession(
  request: Request,
): Promise<UserSession | null> {
  const cookie = await getSession(request.headers.get('Cookie'));
  if (cookie && cookie.get('csrfToken')) {
    return { csrfToken: cookie.get('csrfToken') };
  }
  return null;
}

export async function requireCanonicalSession(
  request: Request,
): Promise<[UserSession, Headers | undefined]> {
  const session = await getUserSession(request);
  const pathname = new URL(request.url).pathname;

  if (new URL(request.url).hostname.startsWith('www.')) {
    const headers = new Headers();
    if (!session) {
      await createUserSession(headers);
    }
    const canonicalUrl = new URL(request.url);
    canonicalUrl.hostname = canonicalUrl.hostname.slice(4);
    if (canonicalUrl.pathname !== '/' && canonicalUrl.pathname.endsWith('/')) {
      canonicalUrl.pathname = canonicalUrl.pathname.slice(0, -1);
    }
    throw redirect(canonicalUrl.toString(), {
      headers,
      status: 301,
      statusText: 'Moved Permanently',
    });
  }

  if (pathname !== '/' && pathname.endsWith('/')) {
    const headers = new Headers();
    if (!session) {
      await createUserSession(headers);
    }
    throw redirect(pathname.slice(0, -1), {
      headers,
      status: 301,
      statusText: 'Moved Permanently',
    });
  }

  if (!session) {
    return createUserSession();
  }
  return [session, undefined];
}
