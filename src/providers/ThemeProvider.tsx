import { ReactNode, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { ThemeContext, Theme } from '../lib/theme';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { address } = useAccount();
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
    return 'dark'; // Default
  });

  const session = useQuery(
    api.auth.getSession,
    address ? { walletAddress: address } : 'skip'
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
    
    // Save to backend if user is authenticated
    if (address) {
      try {
        await updatePreferredTheme({
          walletAddress: address,
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
