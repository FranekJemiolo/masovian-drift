import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/masovian-drift/' : '/',
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('@zxing') || id.includes('qrcode') || id.includes('pako')) {
            return 'vendor-net-qr';
          }
          if (id.includes('@dimforge/rapier3d-compat')) {
            return 'vendor-rapier';
          }
          if (id.includes('three')) {
            return 'vendor-three';
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  server: {
    host: true,
    port: 5173,
  },
});
