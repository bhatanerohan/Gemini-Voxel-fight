import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gemini/, '/v1beta/openai'),
      },
    },
  },
});
