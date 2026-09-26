/** Local-date helpers. All day keys are the user's local calendar date (yyyy-mm-dd). */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}
export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}
export function minutesOfDay(hhmm: string): number {
  const [h, m] = (hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + r.slice(0, 20);
}

export function slugify(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9#+.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

/** Normalizes question text for duplicate detection. */
export function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/\b(what|is|are|the|a|an|of|in|and|to|do|does|you|your|how|explain|with|example|examples|between)\b/g, ' ')
    .replace(/[^a-z0-9#+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Small deterministic string hash (FNV-1a, 32-bit, hex). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  const n = normalizeText(s);
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function tokens(s: string): Set<string> {
  return new Set(normalizeText(s).split(' ').filter(w => w.length > 1));
}
/** Jaccard similarity of normalized word sets. */
export function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(w => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) (out[key(x)] ||= []).push(x);
  return out;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}

/** Strips undefined values so Firestore accepts the object. */
export function clean<T extends object>(o: T): T {
  if (Array.isArray(o)) return o.map(v => (v && typeof v === 'object' ? clean(v) : v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !(v instanceof Date) && Object.getPrototypeOf(v) === Object.prototype ? clean(v as object) : Array.isArray(v) ? clean(v) : v;
  }
  return out as T;
}

export function errorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
    'auth/weak-password': 'Use a stronger password (at least 8 characters).',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'You appear to be offline. Check your connection.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before finishing.',
    'auth/popup-blocked': 'The browser blocked the Google popup. Allow popups and try again.',
    'auth/expired-action-code': 'This link has expired. Request a new one.',
    'auth/invalid-action-code': 'This link is invalid or was already used.',
    'auth/requires-recent-login': 'For security, sign out and sign in again, then retry.',
    'permission-denied': 'You do not have permission to do that.',
    unavailable: 'The server is unreachable. Your changes are saved offline and will sync later.',
  };
  if (map[code]) return map[code];
  const msg = (e as Error)?.message || String(e);
  return msg.replace(/^Firebase: /, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '');
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
