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
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@emotion/react', '@emotion/styled'],
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
        name: 'Hospet Delivery',
        short_name: 'Hospet',
        description: 'Groceries delivered across Hospet in 45 minutes.',
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
