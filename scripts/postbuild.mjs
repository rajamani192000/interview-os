// After a production build: stamp the service-worker cache name and add 404.html (GitHub Pages SPA fallback).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const out = 'dist/interview-os/browser';
const build = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
writeFileSync(`${out}/sw.js`, readFileSync(`${out}/sw.js`, 'utf8').replace('__BUILD__', build));
copyFileSync(`${out}/index.html`, `${out}/404.html`);
writeFileSync(`${out}/.nojekyll`, '');
console.log('postbuild: sw cache ios-shell-' + build + ', 404.html, .nojekyll');
