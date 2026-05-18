import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const dist = resolve(__dir, 'dist');
if (!existsSync(dist)) mkdirSync(dist);

const opts = {
  entryPoints: ['src/panel/panel.js'],
  bundle: true,
  outfile: 'dist/panel.js',
  format: 'iife',
  platform: 'browser',
  target: ['firefox109'],
  sourcemap: watch ? 'inline' : false,
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('Watching...');
} else {
  await esbuild.build(opts);
  for (const [src, dest] of [
    ['src/devtools/devtools.html', 'dist/devtools.html'],
    ['src/devtools/devtools.js',   'dist/devtools.js'],
    ['src/panel/panel.html',       'dist/panel.html'],
    ['src/panel/panel.css',        'dist/panel.css'],
    ['manifest.json',              'dist/manifest.json'],
  ]) {
    cpSync(resolve(__dir, src), resolve(__dir, dest));
  }
  console.log('Build complete → dist/');
}
