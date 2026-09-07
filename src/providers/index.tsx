import { ReactNode } from 'react';
import { ConvexProvider } from './ConvexProvider';
import { ThemeProvider } from './ThemeProvider';
import { I18nProvider } from './I18nProvider';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ConvexProvider>
        <ThemeProvider>
          <I18nProvider>
            {children}
          </I18nProvider>
        </ThemeProvider>
    </ConvexProvider>
  );
}
