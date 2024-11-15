export type UserSession = {
  csrfToken: string;
};

export type SessionManager = {
  createUserSession: (headers?: Headers) => Promise<[UserSession, Headers]>;
  getUserSession: (request: Request) => Promise<UserSession | null>;
  requireCanonicalSession: (request: Request) => Promise<[UserSession, Headers | undefined]>;
};
