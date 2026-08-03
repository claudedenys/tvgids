// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  site: process.env.SITE_URL || 'http://localhost:4321',
  // POST /api/update wordt via fetch (niet form) aangeroepen; checkOrigin blokkeert dit achter een proxy.
  security: { checkOrigin: false },
  vite: {
    optimizeDeps: {
      // Zorg dat react-dom/client als ESM wordt voorgebundeld (anders faalt hydratatie in dev).
      include: ['react', 'react-dom', 'react-dom/client'],
    },
  },
});
