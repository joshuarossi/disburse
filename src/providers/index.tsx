import { ReactNode } from 'react';
import { Web3Provider } from './Web3Provider';
import { ConvexProvider } from './ConvexProvider';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ConvexProvider>
      <Web3Provider>
        {children}
      </Web3Provider>
    </ConvexProvider>
  );
}
