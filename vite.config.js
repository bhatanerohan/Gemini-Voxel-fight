import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const openaiApiKey = env.OPENAI_API_KEY?.trim() ?? '';

  return {
    plugins: [
      {
        name: 'openai-env-guard',
        configureServer(server) {
          server.middlewares.use('/openai', (_req, res, next) => {
            if (openaiApiKey) {
              next();
              return;
            }

            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: {
                message: 'Missing OPENAI_API_KEY in .env. Add it and restart the Vite dev server.',
              },
            }));
          });
        },
      },
    ],
    server: {
      proxy: {
        '/openai': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/openai/, '/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (openaiApiKey) {
                proxyReq.setHeader('Authorization', `Bearer ${openaiApiKey}`);
              }
            });
          },
        },
      },
    },
  };
});
