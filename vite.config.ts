import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { resolveSiteUrl } from './scripts/site-url.mjs'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Canonical and og:url come from here. Baked in rather than read at runtime
    // so the value is identical to the one written into robots.txt and
    // sitemap.xml after the build. See scripts/site-url.mjs.
    'import.meta.env.VITE_SITE_URL': JSON.stringify(resolveSiteUrl()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // three.js gets its own cacheable chunk; fiber/drei are chunked automatically behind the lazy scenes.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('node_modules/motion') || id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'motion'
          return undefined
        },
      },
    },
  },
})
