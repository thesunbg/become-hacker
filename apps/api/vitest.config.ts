import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // NestJS dependency injection reads constructor parameter types from decorator metadata.
  // esbuild, which Vitest uses by default, strips types without emitting that metadata, so
  // every injected dependency arrives as undefined. SWC emits it.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Must run before any app module is imported; see the file for why.
    setupFiles: ['test/setup-env.ts'],
    // Integration tests share one Postgres database, so they must not race each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
