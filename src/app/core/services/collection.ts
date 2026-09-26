import { effect, inject, signal } from '@angular/core';
import { DATA_STORE, QueryOpts, SERVER_TIME } from '../data/store';
import { clean } from '../util';
import { AuthService } from './auth.service';
import { LoadState } from './user.service';

/**
 * Base for per-user collections under users/{uid}/{name}.
 * Keeps a cached list in a signal; writes update the cache optimistically
 * (Firestore's offline cache queues the write when offline).
 */
export abstract class UserCollection<T extends { id?: string }> {
  protected store = inject(DATA_STORE);
  protected auth = inject(AuthService);
  readonly items = signal<(T & { id: string })[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  private loadedFor: string | null = null;
  private pending: Promise<void> | null = null;

  constructor(protected readonly name: string, protected readonly loadQuery: QueryOpts = {}) {
    effect(() => {
      if (!this.auth.uid()) { this.items.set([]); this.loadedFor = null; this.state.set('idle'); }
    });
  }

  protected get uid(): string {
    const u = this.auth.uid();
    if (!u) throw Object.assign(new Error('Please sign in again.'), { code: 'unauthenticated' });
    return u;
  }
  protected coll() {
    return `users/${this.uid}/${this.name}`;
  }

  ensureLoaded(force = false): Promise<void> {
    const uid = this.auth.uid();
    if (!uid) return Promise.resolve();
    if (!force && this.loadedFor === uid && this.state() === 'ready') return Promise.resolve();
    if (this.pending) return this.pending;
    this.state.set('loading');
    this.pending = this.store
      .list<T>(this.coll(), this.loadQuery)
      .then(rows => { this.items.set(rows); this.loadedFor = uid; this.state.set('ready'); })
      .catch(e => { this.error.set((e as Error).message || 'Could not load'); this.state.set('error'); throw e; })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  query(q: QueryOpts) {
    return this.store.list<T>(this.coll(), q);
  }

  byId(id: string) {
    return this.items().find(x => x.id === id);
  }

  async fetch(id: string): Promise<(T & { id: string }) | null> {
    const hit = this.byId(id);
    if (hit) return hit;
    const d = await this.store.get<T & { id: string }>(`${this.coll()}/${id}`);
    return d;
  }

  /** Creates (no id) or replaces (id) a document. Returns the saved item. */
  async save(item: T, id?: string): Promise<T & { id: string }> {
    const docId = id || item.id || this.store.newId(this.coll());
    const existing = this.byId(docId);
    const now = Date.now();
    const data = clean({ ...item, id: undefined, updatedAt: SERVER_TIME, createdAt: (existing as { createdAt?: number } | undefined)?.createdAt ?? SERVER_TIME }) as object;
    const local = { ...item, id: docId, updatedAt: now, createdAt: (existing as { createdAt?: number } | undefined)?.createdAt ?? now } as T & { id: string };
    this.upsertLocal(local);
    try {
      await this.store.set(`${this.coll()}/${docId}`, data);
    } catch (e) {
      if (existing) this.upsertLocal(existing); else this.removeLocal(docId);
      throw e;
    }
    return local;
  }

  async patch(id: string, patch: Partial<T>) {
    const prev = this.byId(id);
    if (prev) this.upsertLocal({ ...prev, ...patch, updatedAt: Date.now() });
    try {
      await this.store.set(`${this.coll()}/${id}`, clean({ ...patch, updatedAt: SERVER_TIME }), true);
    } catch (e) {
      if (prev) this.upsertLocal(prev);
      throw e;
    }
  }

  async remove(id: string) {
    const prev = this.byId(id);
    this.removeLocal(id);
    try {
      await this.store.delete(`${this.coll()}/${id}`);
    } catch (e) {
      if (prev) this.upsertLocal(prev);
      throw e;
    }
  }

  protected upsertLocal(x: T & { id: string }) {
    this.items.update(l => {
      const i = l.findIndex(y => y.id === x.id);
      if (i < 0) return [x, ...l];
      const c = l.slice();
      c[i] = x;
      return c;
    });
  }
  protected removeLocal(id: string) {
    this.items.update(l => l.filter(x => x.id !== id));
  }
}
