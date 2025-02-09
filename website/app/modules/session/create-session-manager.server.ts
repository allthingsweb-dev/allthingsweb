import { createCookieSessionStorage } from "react-router";
import { createCsrfToken } from "./csrf.server";
import { MainConfig } from "~/config.server";

type UserSession = {
  csrfToken: string;
};

export type SessionManager = {
  createUserSession: (headers?: Headers) => Promise<[UserSession, Headers]>;
  getUserSession: (request: Request) => Promise<UserSession | null>;
  requireCanonicalSession: (
    request: Request,
  ) => Promise<[UserSession, Headers | undefined]>;
};

type Deps = {
  mainConfig: MainConfig;
  redirect: typeof import("react-router").redirect;
};
export const createSessionManager = ({
  mainConfig,
  redirect,
}: Deps): SessionManager => {
  const { commitSession, getSession } = createCookieSessionStorage({
    cookie: {
      name: "session",
      secure: true,
      secrets: [mainConfig.sessionSecret],
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
    },
  });

  const createUserSession: SessionManager["createUserSession"] = async (
    headers = new Headers(),
  ) => {
    const cookie = await getSession();

    const csrfToken = createCsrfToken();
    cookie.set("csrfToken", csrfToken);

    const cookieValue = await commitSession(cookie);
    headers.set("Set-Cookie", cookieValue);

    return [{ csrfToken }, headers];
  };

  const getUserSession: SessionManager["getUserSession"] = async (request) => {
    const cookie = await getSession(request.headers.get("Cookie"));
    if (cookie && cookie.get("csrfToken")) {
      return { csrfToken: cookie.get("csrfToken") };
    }
    return null;
  };

  const requireCanonicalSession: SessionManager["requireCanonicalSession"] =
    async (request) => {
      const session = await getUserSession(request);
      const pathname = new URL(request.url).pathname;

      if (new URL(request.url).hostname.startsWith("www.")) {
        const headers = new Headers();
        if (!session) {
          await createUserSession(headers);
        }
        const canonicalUrl = new URL(request.url);
        canonicalUrl.hostname = canonicalUrl.hostname.slice(4);
        if (
          canonicalUrl.pathname !== "/" &&
          canonicalUrl.pathname.endsWith("/")
        ) {
          canonicalUrl.pathname = canonicalUrl.pathname.slice(0, -1);
        }
        throw redirect(canonicalUrl.toString(), {
          headers,
          status: 301,
          statusText: "Moved Permanently",
        });
      }

      if (pathname !== "/" && pathname.endsWith("/")) {
        const headers = new Headers();
        if (!session) {
          await createUserSession(headers);
        }
        throw redirect(pathname.slice(0, -1), {
          headers,
          status: 301,
          statusText: "Moved Permanently",
        });
      }

      if (!session) {
        return createUserSession();
      }
      return [session, undefined];
    };

  return {
    createUserSession,
    getUserSession,
    requireCanonicalSession,
  };
};
