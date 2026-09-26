// After a production build: stamp the service-worker cache name and add 404.html (GitHub Pages SPA fallback).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const out = 'dist/interview-os/browser';
const build = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
// precache every built file so the whole app (all lazy pages) works offline after the first visit
import { readdirSync, statSync } from 'node:fs';
const walk = d => readdirSync(d).flatMap(f => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
const files = walk(out).map(f => './' + f.slice(out.length + 1)).filter(f => !/(^\.\/(sw\.js|404\.html|\.nojekyll)$)|\.map$/.test(f));
let sw = readFileSync(`${out}/sw.js`, 'utf8').replace('__BUILD__', build);
sw = sw.replace(/const SHELL = \[[^\]]*\];/, `const SHELL = ${JSON.stringify(['./', ...files])};`);
writeFileSync(`${out}/sw.js`, sw);
copyFileSync(`${out}/index.html`, `${out}/404.html`);
writeFileSync(`${out}/.nojekyll`, '');
console.log('postbuild: sw cache ios-shell-' + build + ' (' + files.length + ' files precached), 404.html, .nojekyll');
