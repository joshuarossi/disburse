import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Global test configuration
    globals: true,
    
    // Project configuration for different test types (Vitest 4.x syntax)
    projects: [
      // Frontend tests
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      // Convex backend tests
      {
        extends: true,
        test: {
          name: 'convex',
          environment: 'node',
          include: ['convex/**/*.{test,spec}.ts'],
        },
      },
    ],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'convex/_generated/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
    },
  },
});
