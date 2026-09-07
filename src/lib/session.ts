import { useSyncExternalStore } from 'react';

// Client-side session token storage.
// The opaque token is issued once by convex/auth.verifySignature and stored in
// localStorage; it is attached to every authenticated Convex call as
// `sessionToken`. The backend resolves identity exclusively from this token —
// never from client-declared wallet addresses.

const SESSION_TOKEN_KEY = 'disburse.sessionToken';

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveSessionToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
  window.dispatchEvent(new Event('disburse:session'));
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } finally {
    window.dispatchEvent(new Event('disburse:session'));
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_TOKEN_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('disburse:session', onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('disburse:session', onChange);
  };
}

export function useSessionToken(): string | null {
  return useSyncExternalStore(subscribe, getSessionToken, () => null);
}
