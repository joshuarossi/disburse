import { ReactNode, useEffect, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { ThemeContext, Theme } from '../lib/theme';
import { useSessionToken } from '@/lib/session';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Initialize from localStorage or system preference
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
    // Check system preference
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'light'; // Finance workspace defaults to a light reading surface
  });

  const token = useSessionToken();
  const session = useQuery(
    api.auth.validateSession,
    token ? { token } : 'skip',
  );

  const updatePreferredTheme = useMutation(api.users.updatePreferredTheme);

  // Load theme from user preference when session is available
  useEffect(() => {
    if (session?.preferredTheme) {
      setThemeState(session.preferredTheme);
      localStorage.setItem('theme', session.preferredTheme);
    }
  }, [session?.preferredTheme]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const setTheme = async (newTheme: Theme) => {
    setThemeState(newTheme);

    // Save to backend if user is authenticated (identity from session token)
    if (session && token) {
      try {
        await updatePreferredTheme({
          sessionToken: token,
          preferredTheme: newTheme,
        });
      } catch (error) {
        console.error('Failed to update theme preference:', error);
      }
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
