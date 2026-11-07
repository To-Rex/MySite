import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

/**
 * Two projects, because they need different things to exist.
 *
 * - `unit` reads the source. It runs anywhere, in a couple of seconds.
 * - `dist` reads the build output — the CSP that was generated, the chunks that
 *   were emitted, what the minifier did to the CSS — so it needs `npm run build`
 *   to have run first. Those are the failures no amount of reading the source
 *   would show: both bugs fixed alongside this suite were only visible in `dist/`.
 *
 * Built on top of vite.config.ts so `@/` and the baked-in site URL resolve the
 * same way they do in the app.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.{ts,tsx}'] } },
        { extends: true, test: { name: 'dist', include: ['tests/dist/**/*.test.ts'] } },
      ],
    },
  }),
)
