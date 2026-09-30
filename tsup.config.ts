import { execFileSync } from 'node:child_process';
import { replace } from 'esbuild-plugin-replace';
import { defineConfig } from 'tsup';

import json from './package.json';

export default defineConfig({
  platform: 'browser',
  entry: ['src/index.ts'],
  format: ['esm'],
  splitting: false,
  clean: true,
  // TypeScript 7 no longer exposes the compiler API used by tsup's DTS bundler.
  // Run the compiler after each build, including rebuilds in watch mode.
  onSuccess: async () => {
    execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });
  },
  target: 'es2020',
  esbuildPlugins: [
    replace({
      __buildVersion: json.version,
    }),
  ],
});
