import { InjectionToken, Signal } from '@angular/core';

export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
export interface QueryOpts {
  where?: [string, WhereOp, unknown][];
  orderBy?: [string, 'asc' | 'desc'][];
  limit?: number;
  startAfter?: unknown[]; // values matching orderBy fields (cursor pagination)
}
export interface BatchOp {
  type: 'set' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

/** Marker replaced by the backend with a server timestamp (Firestore serverTimestamp()). */
export const SERVER_TIME = '__SERVER_TIME__';
/** Marker for an atomic numeric increment (Firestore increment()). Top-level fields only. */
export const INCREMENT = (n: number) => ({ __increment: n });
export const isIncrement = (v: unknown): v is { __increment: number } => !!v && typeof v === 'object' && '__increment' in (v as object);

/**
 * Data access abstraction. The Firestore implementation is the production source of truth;
 * the memory implementation exists only for local demos and automated tests.
 * All timestamps are returned as epoch milliseconds.
 */
export interface DataStore {
  readonly kind: 'firebase' | 'memory';
  get<T>(path: string): Promise<T | null>;
  list<T>(collectionPath: string, q?: QueryOpts): Promise<(T & { id: string })[]>;
  count(collectionPath: string, q?: QueryOpts): Promise<number>;
  set(path: string, data: object, merge?: boolean): Promise<void>;
  update(path: string, data: object): Promise<void>;
  add(collectionPath: string, data: object): Promise<string>;
  delete(path: string): Promise<void>;
  batch(ops: BatchOp[]): Promise<void>;
  newId(collectionPath: string): string;
  /** Calls back on every change of one document. Returns unsubscribe. */
  watchDoc<T>(path: string, cb: (v: T | null) => void, err?: (e: unknown) => void): () => void;
  /** Writes a server timestamp and reads it back to estimate client clock skew (ms). */
  clockSkew(uid: string): Promise<number>;
  /** Removes this device's offline copy of private data (called on sign-out). */
  clearLocal(): Promise<void>;
}

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  emailVerified: boolean;
  provider: 'password' | 'google' | 'other';
}

export interface AuthBackend {
  /** undefined while the initial auth state is loading */
  readonly user: Signal<AuthUser | null | undefined>;
  register(email: string, password: string, displayName: string): Promise<AuthUser>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signInWithGoogle(): Promise<AuthUser>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  verifyResetCode(code: string): Promise<string>; // returns email
  confirmPasswordReset(code: string, newPassword: string): Promise<void>;
  sendEmailVerification(): Promise<void>;
  applyActionCode(code: string): Promise<void>;
  reload(): Promise<void>;
  deleteAccount(): Promise<void>;
  idToken(): Promise<string | null>;
}

export interface BlobStore {
  readonly kind: 'device' | 'cloud';
  put(key: string, blob: Blob): Promise<string>; // returns ref
  get(ref: string): Promise<Blob | null>;
  remove(ref: string): Promise<void>;
}

export const DATA_STORE = new InjectionToken<DataStore>('DATA_STORE');
export const AUTH_BACKEND = new InjectionToken<AuthBackend>('AUTH_BACKEND');
export const CLOUD_BLOBS = new InjectionToken<BlobStore | null>('CLOUD_BLOBS');
