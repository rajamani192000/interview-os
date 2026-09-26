import { signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  applyActionCode, browserLocalPersistence, browserPopupRedirectResolver, confirmPasswordReset, createUserWithEmailAndPassword, deleteUser, getRedirectResult,
  GoogleAuthProvider, indexedDBLocalPersistence, initializeAuth, onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, User, verifyPasswordResetCode,
} from 'firebase/auth';
import {
  clearIndexedDbPersistence, collection, deleteDoc, doc, DocumentData, Firestore, getCountFromServer, getDoc, getDocs, increment, initializeFirestore, limit, onSnapshot, orderBy,
  persistentLocalCache, persistentMultipleTabManager, query, QueryConstraint, serverTimestamp, setDoc, startAfter, terminate, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import { AuthBackend, AuthUser, BatchOp, BlobStore, DataStore, isIncrement, QueryOpts, SERVER_TIME } from './store';

let app: FirebaseApp | null = null;
export function firebaseApp(): FirebaseApp {
  if (!app) app = getApps().length ? getApp() : initializeApp(environment.firebase);
  return app;
}

/** Converts Firestore Timestamps to epoch ms (deep). */
function fromFs(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toMillis();
  if (Array.isArray(v)) return v.map(fromFs);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = fromFs(x);
    return o;
  }
  return v;
}
/** Replaces SERVER_TIME markers and drops undefined (Firestore rejects undefined). */
function toFs(v: unknown): unknown {
  if (v === SERVER_TIME) return serverTimestamp();
  if (isIncrement(v)) return increment(v.__increment);
  if (Array.isArray(v)) return v.map(toFs);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) o[k] = toFs(x);
    return o;
  }
  return v;
}

export class FirestoreStore implements DataStore {
  readonly kind = 'firebase' as const;
  private db: Firestore;
  constructor(private onBackgroundError: (e: unknown) => void) {
    this.db = initializeFirestore(firebaseApp(), { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  }
  private constraints(q?: QueryOpts): QueryConstraint[] {
    const c: QueryConstraint[] = [];
    q?.where?.forEach(([f, op, v]) => c.push(where(f, op, v)));
    q?.orderBy?.forEach(([f, d]) => c.push(orderBy(f, d)));
    if (q?.startAfter) c.push(startAfter(...q.startAfter));
    if (q?.limit) c.push(limit(q.limit));
    return c;
  }
  /**
   * Firestore resolves writes only after the server acknowledges them. Offline, the write is
   * already applied to the local cache and queued, so we don't block the UI on it: after a short
   * wait we return and report any later failure through onBackgroundError.
   */
  private async settle(p: Promise<unknown>): Promise<void> {
    p.catch(e => this.onBackgroundError(e));
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    await Promise.race([p, new Promise(r => setTimeout(r, 6000))]);
  }
  async get<T>(path: string): Promise<T | null> {
    const s = await getDoc(doc(this.db, path));
    return s.exists() ? ({ ...(fromFs(s.data()) as object), id: s.id } as T) : null;
  }
  async list<T>(path: string, q?: QueryOpts): Promise<(T & { id: string })[]> {
    const s = await getDocs(query(collection(this.db, path), ...this.constraints(q)));
    return s.docs.map(d => ({ ...(fromFs(d.data()) as T), id: d.id }));
  }
  async count(path: string, q?: QueryOpts): Promise<number> {
    const s = await getCountFromServer(query(collection(this.db, path), ...this.constraints({ where: q?.where })));
    return s.data().count;
  }
  set(path: string, data: object, merge = false) {
    return this.settle(setDoc(doc(this.db, path), toFs(data) as DocumentData, { merge }));
  }
  update(path: string, data: object) {
    return this.settle(updateDoc(doc(this.db, path), toFs(data) as DocumentData));
  }
  async add(path: string, data: object) {
    const ref = doc(collection(this.db, path));
    await this.settle(setDoc(ref, toFs(data) as DocumentData));
    return ref.id;
  }
  delete(path: string) {
    return this.settle(deleteDoc(doc(this.db, path)));
  }
  async batch(ops: BatchOp[]) {
    for (let i = 0; i < ops.length; i += 450) {
      const b = writeBatch(this.db);
      for (const op of ops.slice(i, i + 450)) {
        const ref = doc(this.db, op.path);
        if (op.type === 'delete') b.delete(ref);
        else if (op.type === 'update') b.update(ref, toFs(op.data) as DocumentData);
        else b.set(ref, toFs(op.data) as DocumentData, { merge: !!op.merge });
      }
      await this.settle(b.commit());
    }
  }
  newId(path: string) {
    return doc(collection(this.db, path)).id;
  }
  watchDoc<T>(path: string, cb: (v: T | null) => void, err?: (e: unknown) => void) {
    return onSnapshot(doc(this.db, path), s => cb(s.exists() ? ({ ...(fromFs(s.data()) as object), id: s.id } as T) : null), e => err?.(e));
  }
  async clearLocal() {
    try {
      await terminate(this.db);
      await clearIndexedDbPersistence(this.db);
    } catch { /* another tab still open: cache is cleared when the last tab closes */ }
  }
  async clockSkew(uid: string): Promise<number> {
    const t0 = Date.now();
    const ref = doc(this.db, `users/${uid}/settings/clock`);
    await setDoc(ref, { at: serverTimestamp() });
    const s = await getDoc(ref);
    const t1 = Date.now();
    const server = (s.data()?.['at'] as Timestamp | undefined)?.toMillis();
    return server ? server - (t0 + t1) / 2 : 0;
  }
}

function toUser(u: User): AuthUser {
  const google = u.providerData.some(p => p.providerId === 'google.com');
  return {
    uid: u.uid,
    email: u.email || '',
    displayName: u.displayName || (u.email || '').split('@')[0],
    photoURL: u.photoURL || undefined,
    emailVerified: u.emailVerified,
    provider: google ? 'google' : u.providerData.some(p => p.providerId === 'password') ? 'password' : 'other',
  };
}

export class FirebaseAuthBackend implements AuthBackend {
  readonly user = signal<AuthUser | null | undefined>(undefined);
  private auth = initializeAuth(firebaseApp(), { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
  constructor() {
    onAuthStateChanged(this.auth, u => this.user.set(u ? toUser(u) : null));
    getRedirectResult(this.auth).catch(() => undefined);
  }
  private emit(u: User) {
    const x = toUser(u);
    this.user.set(x);
    return x;
  }
  async register(email: string, password: string, displayName: string) {
    const c = await createUserWithEmailAndPassword(this.auth, email, password);
    if (displayName) await updateProfile(c.user, { displayName });
    sendEmailVerification(c.user).catch(() => undefined);
    return this.emit(c.user);
  }
  async signIn(email: string, password: string) {
    return this.emit((await signInWithEmailAndPassword(this.auth, email, password)).user);
  }
  async signInWithGoogle() {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    try {
      return this.emit((await signInWithPopup(this.auth, p)).user);
    } catch (e) {
      if ((e as { code?: string }).code === 'auth/popup-blocked') {
        await signInWithRedirect(this.auth, p);
        return new Promise<AuthUser>(() => undefined); // page navigates away
      }
      throw e;
    }
  }
  signOut() {
    return signOut(this.auth);
  }
  sendPasswordReset(email: string) {
    const url = `${location.origin}${document.baseURI.replace(location.origin, '')}login`;
    return sendPasswordResetEmail(this.auth, email, { url }).catch(e => {
      // continue URL not in Authorized domains: send the plain reset email instead
      if (/unauthorized-continue-uri|invalid-continue-uri/.test((e as { code?: string }).code || '')) return sendPasswordResetEmail(this.auth, email);
      throw e;
    });
  }
  verifyResetCode(code: string) {
    return verifyPasswordResetCode(this.auth, code);
  }
  confirmPasswordReset(code: string, pw: string) {
    return confirmPasswordReset(this.auth, code, pw);
  }
  async sendEmailVerification() {
    if (this.auth.currentUser) await sendEmailVerification(this.auth.currentUser);
  }
  applyActionCode(code: string) {
    return applyActionCode(this.auth, code);
  }
  async reload() {
    if (this.auth.currentUser) { await reload(this.auth.currentUser); this.emit(this.auth.currentUser); }
  }
  async deleteAccount() {
    if (this.auth.currentUser) await deleteUser(this.auth.currentUser);
  }
  async idToken() {
    return this.auth.currentUser ? this.auth.currentUser.getIdToken() : null;
  }
}

/** Firebase Storage for voice recordings (Blaze plan only; enabled via environment.features.storage). */
export class FirebaseBlobStore implements BlobStore {
  readonly kind = 'cloud' as const;
  constructor(private uid: () => string | undefined) {}
  private async sdk() {
    return import('firebase/storage');
  }
  async put(key: string, blob: Blob) {
    const { getStorage, ref, uploadBytes } = await this.sdk();
    const path = `users/${this.uid()}/recordings/${key}`;
    await uploadBytes(ref(getStorage(firebaseApp()), path), blob, { contentType: blob.type || 'audio/webm' });
    return 'cloud:' + path;
  }
  async get(r: string) {
    const { getStorage, ref, getBlob } = await this.sdk();
    return getBlob(ref(getStorage(firebaseApp()), r.replace(/^cloud:/, '')));
  }
  async remove(r: string) {
    const { getStorage, ref, deleteObject } = await this.sdk();
    await deleteObject(ref(getStorage(firebaseApp()), r.replace(/^cloud:/, '')));
  }
}
