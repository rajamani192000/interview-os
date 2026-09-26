// Tiny static server with SPA fallback for e2e tests: node scripts/serve.mjs <dir> <port>
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const [dir = 'dist/interview-os/browser', port = '4300'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
createServer((req, res) => {
  const p = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let f = join(dir, p);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(dir, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(+port, () => console.log(`serving ${dir} on http://localhost:${port}`));
