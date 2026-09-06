import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 3020 },
  build: {
    // Enforce the performance budget from the plan: the customer bundle must
    // stay small enough to be interactive in under 3s on a mid-range Android.
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        // Only the framework is force-grouped. MUI is deliberately NOT a
        // single manual chunk: doing that pulled admin-only components
        // (Autocomplete, pickers) into the shared vendor bundle, so customers
        // paid to download admin UI they can never reach. Letting Rollup split
        // it by actual usage keeps the shop lean.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Wink',
        short_name: 'Wink',
        description: 'Everything you need, in a wink. Groceries delivered across Hospet.',
        theme_color: '#0B6E4F',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/storage\/v1\/object\/public\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'product-images',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
})
