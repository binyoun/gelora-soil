import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: '/gelora-soil/',
  plugins: [basicSsl()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    https: true,
    host: true,
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
});
