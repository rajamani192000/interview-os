import { signal } from '@angular/core';
import { AuthBackend, AuthUser, BatchOp, DataStore, QueryOpts, SERVER_TIME } from './store';

/**
 * In-browser fake backend for LOCAL DEMO and AUTOMATED TESTS only (environment.backend = 'memory').
 * It mirrors the ownership rules of firestore.rules so tests catch permission mistakes,
 * and persists to localStorage so page reloads keep state. Never used in production builds.
 */
const DB_KEY = 'ios.memory.db.v1';
const AUTH_KEY = 'ios.memory.auth.v1';

type Doc = Record<string, unknown>;

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

export class PermissionError extends Error {
  code = 'permission-denied';
}

export class MemoryStore implements DataStore {
  readonly kind = 'memory' as const;
  private docs: Record<string, Doc> = load(DB_KEY, {});
  constructor(private currentUid: () => string | null, private isAdminEmail: () => boolean) {}

  private persist() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(this.docs)); } catch { /* quota: ignore in demo */ }
  }
  private resolve(v: unknown): unknown {
    if (v === SERVER_TIME) return Date.now();
    if (Array.isArray(v)) return v.map(x => this.resolve(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, this.resolve(x)]));
    return v;
  }
  private isAdmin(): boolean {
    const uid = this.currentUid();
    return !!uid && (this.isAdminEmail() || !!this.docs[`admins/${uid}`]);
  }
  /** Same decisions as firestore.rules. */
  private check(path: string, write: boolean) {
    const uid = this.currentUid();
    const seg = path.split('/');
    if (!uid) throw new PermissionError('Missing or insufficient permissions (signed out).');
    if (seg[0] === 'users') { if (seg[1] !== uid) throw new PermissionError('Missing or insufficient permissions.'); return; }
    if (['categories', 'topics', 'questions', 'meta'].includes(seg[0])) { if (write && !this.isAdmin()) throw new PermissionError('Admins only.'); return; }
    if (seg[0] === 'admins') { if (write || seg[1] !== uid) throw new PermissionError('Missing or insufficient permissions.'); return; }
    throw new PermissionError('Missing or insufficient permissions.');
  }
  private delay() {
    return new Promise(r => setTimeout(r, 5));
  }
  async get<T>(path: string) {
    this.check(path, false);
    await this.delay();
    const d = this.docs[path];
    return d ? (structuredClone({ ...d, id: path.split('/').pop() }) as T) : null;
  }
  private children(coll: string) {
    const depth = coll.split('/').length + 1;
    return Object.entries(this.docs).filter(([p]) => p.startsWith(coll + '/') && p.split('/').length === depth);
  }
  private filter(coll: string, q?: QueryOpts) {
    let rows = this.children(coll).map(([p, d]) => ({ ...d, id: p.split('/').pop()! }) as Doc & { id: string });
    for (const [f, op, v] of q?.where || []) {
      rows = rows.filter(r => {
        const x = r[f] as never;
        switch (op) {
          case '==': return x === v;
          case '!=': return x !== v;
          case '<': return x < (v as never);
          case '<=': return x <= (v as never);
          case '>': return x > (v as never);
          case '>=': return x >= (v as never);
          case 'in': return (v as unknown[]).includes(x);
          case 'array-contains': return Array.isArray(x) && (x as unknown[]).includes(v);
        }
      });
    }
    const ob = q?.orderBy || [];
    if (ob.length) {
      rows = rows.filter(r => ob.every(([f]) => r[f] !== undefined));
      rows.sort((a, b) => {
        for (const [f, d] of ob) {
          const x = a[f] as never, y = b[f] as never;
          if (x !== y) return (x < y ? -1 : 1) * (d === 'desc' ? -1 : 1);
        }
        return a.id.localeCompare(b.id);
      });
      if (q?.startAfter) {
        const idx = rows.findIndex(r => ob.every(([f], i) => r[f] === q.startAfter![i]));
        if (idx >= 0) rows = rows.slice(idx + 1);
      }
    }
    if (q?.limit) rows = rows.slice(0, q.limit);
    return rows;
  }
  async list<T>(coll: string, q?: QueryOpts) {
    this.check(coll + '/x', false);
    await this.delay();
    return structuredClone(this.filter(coll, q)) as unknown as (T & { id: string })[];
  }
  async count(coll: string, q?: QueryOpts) {
    this.check(coll + '/x', false);
    return this.filter(coll, { where: q?.where }).length;
  }
  private apply(op: BatchOp) {
    this.check(op.path, true);
    if (op.type === 'delete') { delete this.docs[op.path]; return; }
    const data = this.resolve(op.data || {}) as Doc;
    delete data['id'];
    if (op.type === 'update') {
      if (!this.docs[op.path]) throw Object.assign(new Error('No document to update: ' + op.path), { code: 'not-found' });
      this.docs[op.path] = { ...this.docs[op.path], ...data };
    } else this.docs[op.path] = op.merge ? { ...(this.docs[op.path] || {}), ...data } : data;
  }
  async set(path: string, data: object, merge = false) {
    await this.delay();
    this.apply({ type: 'set', path, data: data as Doc, merge });
    this.persist();
    this.notify(path);
  }
  async update(path: string, data: object) {
    await this.delay();
    this.apply({ type: 'update', path, data: data as Doc });
    this.persist();
    this.notify(path);
  }
  async add(coll: string, data: object) {
    const id = this.newId(coll);
    await this.set(`${coll}/${id}`, data);
    return id;
  }
  async delete(path: string) {
    await this.delay();
    this.apply({ type: 'delete', path });
    this.persist();
    this.notify(path);
  }
  async batch(ops: BatchOp[]) {
    await this.delay();
    const snapshot = structuredClone(this.docs);
    try { ops.forEach(o => this.apply(o)); } catch (e) { this.docs = snapshot; throw e; } // atomic like Firestore
    this.persist();
    ops.forEach(o => this.notify(o.path));
  }
  newId(_coll?: string) {
    return Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-6);
  }
  private watchers = new Map<string, Set<(v: unknown) => void>>();
  private notify(path: string) {
    const d = this.docs[path];
    this.watchers.get(path)?.forEach(cb => cb(d ? structuredClone({ ...d, id: path.split('/').pop() }) : null));
  }
  watchDoc<T>(path: string, cb: (v: T | null) => void, err?: (e: unknown) => void) {
    try { this.check(path, false); } catch (e) { err?.(e); return () => undefined; }
    const set = this.watchers.get(path) ?? this.watchers.set(path, new Set()).get(path)!;
    const f = cb as (v: unknown) => void;
    set.add(f);
    setTimeout(() => this.notify(path), 0);
    return () => set.delete(f);
  }
  async clearLocal() { /* the memory store is the demo 'server' */ }
  async clockSkew() {
    return 0;
  }
}

interface MemAccount { uid: string; email: string; displayName: string; pwHash: string; emailVerified: boolean; }

async function sha(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function err(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export class MemoryAuthBackend implements AuthBackend {
  readonly user = signal<AuthUser | null | undefined>(undefined);
  private state = load<{ accounts: MemAccount[]; current: string | null; resetCodes: Record<string, string> }>(AUTH_KEY, { accounts: [], current: null, resetCodes: {} });
  constructor() {
    setTimeout(() => this.user.set(this.toUser(this.state.accounts.find(a => a.uid === this.state.current))), 10);
  }
  private save() {
    localStorage.setItem(AUTH_KEY, JSON.stringify(this.state));
  }
  private toUser(a?: MemAccount): AuthUser | null {
    return a ? { uid: a.uid, email: a.email, displayName: a.displayName, emailVerified: a.emailVerified, provider: a.pwHash === 'google' ? 'google' : 'password' } : null;
  }
  private login(a: MemAccount) {
    this.state.current = a.uid;
    this.save();
    const u = this.toUser(a)!;
    this.user.set(u);
    return u;
  }
  async register(email: string, password: string, displayName: string) {
    email = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err('auth/invalid-email', 'invalid email');
    if (password.length < 8) throw err('auth/weak-password', 'weak');
    if (this.state.accounts.some(a => a.email === email)) throw err('auth/email-already-in-use', 'in use');
    const a: MemAccount = { uid: 'u' + (await sha(email)).slice(0, 20), email, displayName: displayName || email.split('@')[0], pwHash: await sha(email + password), emailVerified: false };
    this.state.accounts.push(a);
    return this.login(a);
  }
  async signIn(email: string, password: string) {
    email = email.trim().toLowerCase();
    const a = this.state.accounts.find(x => x.email === email);
    if (!a || a.pwHash !== (await sha(email + password))) throw err('auth/invalid-credential', 'bad');
    return this.login(a);
  }
  async signInWithGoogle(): Promise<AuthUser> {
    throw err('auth/operation-not-supported-in-this-environment', 'Google sign-in is not available in local demo mode. Use email and password.');
  }
  async signOut() {
    this.state.current = null;
    this.save();
    this.user.set(null);
  }
  async sendPasswordReset(email: string) {
    const a = this.state.accounts.find(x => x.email === email.trim().toLowerCase());
    if (a) { const code = 'reset-' + a.uid.slice(1, 9); this.state.resetCodes[code] = a.email; this.save(); console.info('[memory auth] reset link: reset-password?mode=resetPassword&oobCode=' + code); }
  }
  async verifyResetCode(code: string) {
    const e = this.state.resetCodes[code];
    if (!e) throw err('auth/invalid-action-code', 'invalid');
    return e;
  }
  async confirmPasswordReset(code: string, pw: string) {
    const email = await this.verifyResetCode(code);
    const a = this.state.accounts.find(x => x.email === email)!;
    a.pwHash = await sha(email + pw);
    delete this.state.resetCodes[code];
    this.save();
  }
  async sendEmailVerification() { /* no email in demo mode */ }
  async applyActionCode() {
    const a = this.state.accounts.find(x => x.uid === this.state.current);
    if (a) { a.emailVerified = true; this.save(); this.login(a); }
  }
  async reload() { /* nothing */ }
  async idToken() { return this.state.current ? 'memory-token-' + this.state.current : null; }
  async deleteAccount() {
    this.state.accounts = this.state.accounts.filter(a => a.uid !== this.state.current);
    await this.signOut();
  }
}
