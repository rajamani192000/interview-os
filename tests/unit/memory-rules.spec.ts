import { beforeAll, describe, expect, it } from 'vitest';

// localStorage shim so the demo backend can run under node
beforeAll(() => {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) };
});

describe('memory backend mirrors firestore.rules ownership', async () => {
  const { MemoryStore } = await import('../../src/app/core/data/memory-backend');
  let uid: string | null = 'alice';
  let admin = false;
  const db = new MemoryStore(() => uid, () => admin);
  it('owner can write and read own data', async () => {
    await db.set('users/alice/notes/n1', { body: 'x' });
    expect((await db.get<{ body: string }>('users/alice/notes/n1'))!.body).toBe('x');
  });
  it('other users and signed-out users are denied', async () => {
    uid = 'bob';
    await expect(db.get('users/alice/notes/n1')).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(db.set('users/alice/notes/n2', {})).rejects.toMatchObject({ code: 'permission-denied' });
    uid = null;
    await expect(db.list('questions')).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('master data: read for signed-in users, write for admins only; admins/ never writable', async () => {
    uid = 'bob';
    await expect(db.set('questions/q1', { question: 'x' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await db.list('questions')).toEqual([]);
    admin = true;
    await db.set('questions/q1', { question: 'What is DI?' });
    expect((await db.list('questions')).length).toBe(1);
    await expect(db.set('admins/bob', {})).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('batches are atomic', async () => {
    admin = false;
    await expect(db.batch([{ type: 'set', path: 'users/bob/notes/a', data: {} }, { type: 'set', path: 'questions/q2', data: {} }])).rejects.toBeTruthy();
    expect(await db.get('users/bob/notes/a')).toBeNull();
  });
});
