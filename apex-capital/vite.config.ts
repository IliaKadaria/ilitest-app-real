import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  // the artifact sandbox only allows inline (data:) images and fonts
  build: { assetsInlineLimit: mode === 'artifact' ? 100_000_000 : 4096 },
}));
