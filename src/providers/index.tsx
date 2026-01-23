import { ReactNode } from 'react';
import { Web3Provider } from './Web3Provider';
import { ConvexProvider } from './ConvexProvider';
import { I18nProvider } from './I18nProvider';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ConvexProvider>
      <Web3Provider>
        <I18nProvider>
          {children}
        </I18nProvider>
      </Web3Provider>
    </ConvexProvider>
  );
}
