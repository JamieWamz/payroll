import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    environment: 'jsdom',
    restoreMocks: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
