import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { env } from "../env.server";
import { createCsrfToken } from "./csrf.server";

const { commitSession, destroySession, getSession } =
  createCookieSessionStorage({
    cookie: {
      name: "session",
      secure: true,
      secrets: [env.sessionSecret],
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
    },
  });

export async function createUserSession(headers = new Headers()): Promise<[UserSession, Headers]> {
  const cookie = await getSession();

  const csrfToken = createCsrfToken();
  cookie.set("csrfToken", csrfToken);

  const cookieValue = await commitSession(cookie);
  headers.set("Set-Cookie", cookieValue);

  return [{ csrfToken }, headers];
}

export type UserSession = {
  csrfToken: string;
};

export async function getUserSession(
  request: Request
): Promise<UserSession | null> {
  const cookie = await getSession(request.headers.get("Cookie"));
  if (cookie && cookie.get("csrfToken")) {
    return { csrfToken: cookie.get("csrfToken") };
  }
  return null;
}

export async function requireUserSession(request: Request): Promise<[UserSession, Headers | undefined]> {
    const session = await getUserSession(request);
    const pathname = new URL(request.url).pathname;
  
    if (pathname !== "/" && pathname.endsWith("/")) {
      const headers = new Headers();
      if(!session) {
        await createUserSession(headers);
      }
      throw redirect(pathname.slice(0, -1), { headers });
    }
  
    if(!session) {
      return createUserSession();
    }
    return [session, undefined];
}
