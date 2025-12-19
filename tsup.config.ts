import { replace } from 'esbuild-plugin-replace';
import { defineConfig } from 'tsup';

import json from './package.json';

export default defineConfig({
  platform: 'browser',
  entry: ['src/index.ts'],
  format: ['esm'],
  splitting: false,
  clean: true,
  dts: true,
  target: 'es2020',
  esbuildPlugins: [
    replace({
      __buildVersion: json.version,
    }),
  ],
});
