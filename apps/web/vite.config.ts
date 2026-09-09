import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const apiProxyTarget =
  process.env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000';

// Exercise the deployed image/script policy in the built preview too.
const contentSecurityPolicy = readFileSync(
  new URL('./docker/default.conf', import.meta.url),
  'utf8',
).match(/add_header Content-Security-Policy "([^"]+)"/)?.[1];
if (!contentSecurityPolicy)
  throw new Error('Missing web content security policy');

export default defineConfig({
  plugins: [react()],
  preview: { headers: { 'Content-Security-Policy': contentSecurityPolicy } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        changeOrigin: true,
        target: apiProxyTarget,
      },
    },
  },
});
