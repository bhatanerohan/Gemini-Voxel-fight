import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const geminiKey = env.GEMINI_API_KEY || '';
  const llamaCloudKey = env.LLAMA_CLOUD_API_KEY || '';

  return {
    server: {
      proxy: {
        '/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gemini/, '/v1beta/openai'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (geminiKey) proxyReq.setHeader('Authorization', `Bearer ${geminiKey}`);
            });
          },
        },
        '/llamaparse/v2': {
          target: 'https://api.cloud.llamaindex.ai',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/llamaparse/, '/api'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (llamaCloudKey) proxyReq.setHeader('Authorization', `Bearer ${llamaCloudKey}`);
            });
          },
        },
      },
    },
  };
});
