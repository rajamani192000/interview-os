import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AUTH_BACKEND, AuthUser, DATA_STORE } from '../data/store';
import { ClockService } from './platform.service';

/** Wraps Firebase Auth (or the demo backend). Admin role = existence of admins/{uid}, enforced by security rules. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private backend = inject(AUTH_BACKEND);
  private store = inject(DATA_STORE);
  private clock = inject(ClockService);
  readonly user = this.backend.user;
  readonly ready = computed(() => this.user() !== undefined);
  readonly signedIn = computed(() => !!this.user());
  readonly uid = computed(() => this.user()?.uid ?? null);
  readonly isAdmin = signal<boolean | undefined>(undefined);

  constructor() {
    effect(() => {
      const u = this.user();
      if (u === undefined) return;
      if (!u) { this.isAdmin.set(false); return; }
      this.isAdmin.set(undefined);
      this.checkAdmin(u).then(v => this.isAdmin.set(v));
      this.store.clockSkew(u.uid).then(s => this.clock.setSkew(s)).catch(() => undefined);
    });
  }

  private async checkAdmin(u: AuthUser): Promise<boolean> {
    if (environment.backend === 'memory' && environment.memoryAdmins.includes(u.email)) return true;
    try {
      return !!(await this.store.get(`admins/${u.uid}`));
    } catch {
      return false;
    }
  }

  /** Resolves once the initial auth state is known. */
  whenReady(): Promise<AuthUser | null> {
    return new Promise(res => {
      const tick = () => (this.user() === undefined ? setTimeout(tick, 20) : res(this.user() ?? null));
      tick();
    });
  }
  async whenAdminKnown(): Promise<boolean> {
    await this.whenReady();
    return new Promise(res => {
      const tick = () => (this.isAdmin() === undefined ? setTimeout(tick, 20) : res(!!this.isAdmin()));
      tick();
    });
  }

  register(email: string, pw: string, name: string) { return this.backend.register(email.trim(), pw, name.trim()); }
  signIn(email: string, pw: string) { return this.backend.signIn(email.trim(), pw); }
  google() { return this.backend.signInWithGoogle(); }
  /**
   * Signs out and clears private state: Firestore offline cache is wiped and the page reloads,
   * so no signal, cache or listener keeps the previous user's data.
   */
  async signOut() {
    await this.backend.signOut();
    await this.store.clearLocal();
    const { kv } = await import('../data/kv');
    await kv.clearPrefix('rec.');
    await kv.clearPrefix('ai.key.');
    try { localStorage.removeItem('ios.reminder.v1'); } catch { /* ignore */ }
    location.replace(document.baseURI + 'login');
  }
  sendReset(email: string) { return this.backend.sendPasswordReset(email.trim()); }
  verifyResetCode(code: string) { return this.backend.verifyResetCode(code); }
  confirmReset(code: string, pw: string) { return this.backend.confirmPasswordReset(code, pw); }
  sendVerification() { return this.backend.sendEmailVerification(); }
  applyCode(code: string) { return this.backend.applyActionCode(code); }
  reload() { return this.backend.reload(); }
  deleteAccount() { return this.backend.deleteAccount(); }
  idToken() { return this.backend.idToken(); }
}
