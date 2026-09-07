import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionToken,
  saveSessionToken,
  useSessionToken,
} from '../session';

describe('session subscription', () => {
  beforeEach(() => localStorage.clear());
  it('updates immediately after sign-in and logout in the same tab', () => {
    const { result } = renderHook(useSessionToken);
    expect(result.current).toBeNull();
    act(() => saveSessionToken('test-session'));
    expect(result.current).toBe('test-session');
    act(clearSessionToken);
    expect(result.current).toBeNull();
  });
  it('reacts to logout in another tab', () => {
    saveSessionToken('test-session');
    const { result } = renderHook(useSessionToken);
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(result.current).toBeNull();
  });
});
