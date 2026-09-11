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
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'brand/*'],
      manifest: {
        name: 'FAA — Fast at any Accuracy',
        short_name: 'FAA',
        description: 'FAA it, get it, love it. Everyday essentials delivered in minutes across Hospet.',
        theme_color: '#E5231F',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        orientation: 'portrait',
        categories: ['shopping', 'food'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Android masks icons to the device's shape; a maskable icon has the
          // mark inset into the safe zone so it is never clipped.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Catalogue photos (public/catalogue) and the preview's sample photos
        // ship with the site but must not bloat the precache; catalogue photos
        // are cached on first view like the uploaded product images.
        globIgnores: ['**/catalogue/**', '**/storefront/products/**'],
        // Deliberately nothing for map tiles or Google APIs: Google's terms
        // forbid caching map and place data, and Workbox leaves cross-origin
        // requests alone unless a route matches, so maps.googleapis.com,
        // places.googleapis.com and tile.openstreetmap.org always hit the network.
        runtimeCaching: [
          {
            urlPattern: /\/catalogue\/.*\.(?:jpg|png|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'catalogue-images',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
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
