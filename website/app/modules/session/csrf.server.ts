import crypto from 'node:crypto';

export function createCsrfToken() {
  return crypto.randomUUID();
}

function validateCsrfToken(
  tokenFromSession: string | null | undefined,
  token: FormDataEntryValue | null,
) {
  if (!tokenFromSession) {
    return false;
  }
  return tokenFromSession === token;
}

export async function requireValidCsrfToken(
  tokenFromSession: string | null | undefined,
  token: FormDataEntryValue | null,
) {
  const isValid = await validateCsrfToken(tokenFromSession, token);
  if (!isValid) {
    throw new Response('Invalid CSRF token. Do not use third-party tools.', {
      status: 403,
    });
  }
}
