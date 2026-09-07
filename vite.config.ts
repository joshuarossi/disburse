import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { releaseConfigurationErrors } from './scripts/check-release-config.mjs';

export default defineConfig(({ command, mode }) => {
  // QA is a local serve-only sandbox. Production builds always use real auth and services.
  if (command === 'build' && mode === 'qa')
    throw new Error(
      'QA mode is local and serve-only. Use the normal production build.',
    );
  const qa = command === 'serve' && mode === 'qa';
  const root = path.resolve(__dirname, 'src/dev/qa');
  return {
    // File-request failures in QA must not depend on a developer's real backend.
    // Browser stories intercept this reserved address; it is never used in builds.
    define: qa ? {
      'import.meta.env.VITE_CONVEX_SITE_URL': JSON.stringify('https://invoice-storage.example.invalid'),
    } : undefined,
    plugins: [
      command === 'build' && {
        name: 'validate-release-environment',
        configResolved(config) {
          const errors = releaseConfigurationErrors({ ...process.env, ...config.env });
          if (errors.length) throw new Error(errors.join('\n'));
        },
      },
      qa && {
        name: 'isolated-visual-qa',
        enforce: 'pre' as const,
        resolveId(source: string, importer?: string) {
          if (importer?.startsWith(root)) return null;
          if (source.endsWith('/providers/WalletRoutes')) return path.join(root, 'WalletRoutes.tsx');
          if (
            source === '@/lib/convex' ||
            /\/src\/lib\/convex(?:\.ts)?$/.test(source)
          )
            return path.join(root, 'client.ts');
          if (/\/src\/lib\/session(?:\.ts)?$/.test(source))
            return path.join(root, 'session.ts');
          if (source === 'convex/react') return path.join(root, 'convex.tsx');
          if (source === '@/lib/safeCreation' || /\/src\/lib\/safeCreation(?:\.ts)?$/.test(source)) return path.join(root, 'safeCreation.ts');
          if (
            source === '@/lib/safeAllowance' ||
            /\/src\/lib\/safeAllowance(?:\.ts)?$/.test(source)
          )
            return path.join(root, 'allowances.ts');
          if (source === '@/lib/delegatedTransfer' || /\/src\/lib\/delegatedTransfer(?:\.ts)?$/.test(source)) return path.join(root, 'delegatedTransfer.ts');
          if (source === '@/lib/accountApproval' || /\/src\/lib\/accountApproval(?:\.ts)?$/.test(source)) return path.join(root, 'accountApproval.ts');
          if (source === 'wagmi') return path.join(root, 'wagmi.ts');
          if (
            source === '@/lib/session' ||
            (importer?.endsWith('/src/main.tsx') && source === './providers')
          )
            return path.join(
              root,
              source === './providers' ? 'Providers.tsx' : 'session.ts',
            );
          return null;
        },
      },
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  };
});
