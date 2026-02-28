import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const geminiApiKey = env.GEMINI_API_KEY?.trim() ?? '';

  return {
    server: {
      proxy: {
        '/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gemini/, '/v1beta/openai'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (geminiApiKey) {
                proxyReq.setHeader('Authorization', `Bearer ${geminiApiKey}`);
              }
            });
          },
        },
      },
    },
  };
});
