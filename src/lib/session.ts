// Client-side session token storage.
// The opaque token is issued once by convex/auth.verifySignature and stored in
// localStorage; it is attached to every authenticated Convex call as
// `sessionToken`. The backend resolves identity exclusively from this token —
// never from client-declared wallet addresses.

const SESSION_TOKEN_KEY = "disburse.sessionToken";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveSessionToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}
