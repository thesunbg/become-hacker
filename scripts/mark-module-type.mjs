#!/usr/bin/env node
/**
 * Marks a build output directory as CommonJS or ESM.
 *
 * The dual-built packages declare `"type": "module"`, which Node applies to every .js file
 * beneath them — including the CommonJS build. Without a nested package.json saying
 * otherwise, `require()` of dist/cjs fails with "exports is not defined in ES module scope",
 * and nothing catches it until something actually runs: type checking passes, and a bundler
 * or Vitest resolves the ESM entry instead.
 *
 * Usage: node scripts/mark-module-type.mjs <dir> <commonjs|module>
 */
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, type] = process.argv.slice(2);

if (dir === undefined || (type !== 'commonjs' && type !== 'module')) {
  console.error('usage: mark-module-type.mjs <dir> <commonjs|module>');
  process.exit(1);
}
if (!existsSync(dir)) {
  console.error(`mark-module-type: ${dir} does not exist — did the compile step run?`);
  process.exit(1);
}

writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
