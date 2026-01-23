import { ReactNode, useEffect, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { config } from '@/lib/wagmi';
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

interface Web3ProviderProps {
  children: ReactNode;
}

function RainbowKitThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  useEffect(() => {
    // Read theme from data-theme attribute
    const updateTheme = () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' | null;
      if (currentTheme === 'dark' || currentTheme === 'light') {
        setTheme(currentTheme);
      }
    };
    
    // Initial read
    updateTheme();
    
    // Watch for changes
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    
    return () => observer.disconnect();
  }, []);
  
  return (
    <RainbowKitProvider
      theme={theme === 'dark' 
        ? darkTheme({
            accentColor: '#14b8a6',
            accentColorForeground: '#0a0f1a',
            borderRadius: 'medium',
            fontStack: 'system',
          })
        : lightTheme({
            accentColor: '#14b8a6',
            accentColorForeground: '#ffffff',
            borderRadius: 'medium',
            fontStack: 'system',
          })
      }
    >
      {children}
    </RainbowKitProvider>
  );
}

export function Web3Provider({ children }: Web3ProviderProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitThemeProvider>
          {children}
        </RainbowKitThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
