import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Build = un unico dist/index.html autonomo, apribile con doppio click (file://)
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  server: { port: Number(process.env.PORT) || 5199 },
});
