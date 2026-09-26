// Generates src/environments/environment.ts from environment variables (or a .env file), so real
// config never has to be committed. Usage:  FIREBASE_API_KEY=... FIREBASE_PROJECT_ID=... npm run env
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const e = process.env;
const need = ['FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID'];
const missing = need.filter(k => !e[k]);
if (missing.length) { console.error('Missing: ' + missing.join(', ') + '  (see SETUP.md step 9)'); process.exit(1); }
const pid = e.FIREBASE_PROJECT_ID;
let src = readFileSync('src/environments/environment.example.ts', 'utf8');
const put = (ph, v) => { src = src.split(ph).join(v); };
put("'YOUR_FIREBASE_WEB_API_KEY'", JSON.stringify(e.FIREBASE_API_KEY));
put("'YOUR_PROJECT_ID.firebaseapp.com'", JSON.stringify(e.FIREBASE_AUTH_DOMAIN || `${pid}.firebaseapp.com`));
put("'YOUR_PROJECT_ID.firebasestorage.app'", JSON.stringify(e.FIREBASE_STORAGE_BUCKET || `${pid}.firebasestorage.app`));
put("'YOUR_PROJECT_ID'", JSON.stringify(pid));
put("'YOUR_SENDER_ID'", JSON.stringify(e.FIREBASE_MESSAGING_SENDER_ID || ''));
put("'YOUR_WEB_APP_ID'", JSON.stringify(e.FIREBASE_APP_ID || ''));
if (e.FCM_VAPID_KEY) put("fcmVapidKey: ''", `fcmVapidKey: ${JSON.stringify(e.FCM_VAPID_KEY)}`);
if (e.AI_PROXY_URL) put("aiProxyUrl: ''", `aiProxyUrl: ${JSON.stringify(e.AI_PROXY_URL)}`);
for (const f of ['storage', 'messaging', 'functions']) if (e['FEATURE_' + f.toUpperCase()] === 'true') src = src.replace(new RegExp(`${f}: false`), `${f}: true`);
writeFileSync('src/environments/environment.ts', src);
console.log('Wrote src/environments/environment.ts for project ' + pid);
