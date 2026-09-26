import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/services/auth.service';
import { NetService } from '../core/services/platform.service';
import { UserService } from '../core/services/user.service';
import { errorMessage } from '../core/util';
import { PublicNavComponent } from './public-pages';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Maps Firebase errors to safe user-facing text (never raw internals). */
function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  const m = errorMessage(e);
  if (code.startsWith('auth/') || ['permission-denied', 'unavailable'].includes(code)) {
    return m.includes(' ') && !/firebase|internal|identitytoolkit/i.test(m) ? m : 'Something went wrong. Please try again.';
  }
  return /network|fetch|offline/i.test(m) ? 'You appear to be offline. Check your connection.' : 'Something went wrong. Please try again.';
}

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, PublicNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav />
  <main class="page narrow">
    <form class="card stack" (ngSubmit)="submit()" novalidate>
      <h1>Sign in</h1>
      @if (demo) { <div class="banner warn small">Local demo mode: data is stored only in this browser.</div> }
      @if (!net.online()) { <div class="banner warn small">You are offline. Sign-in needs a connection.</div> }
      <div class="field"><label for="email">Email</label>
        <input id="email" name="email" class="input" type="email" autocomplete="email" inputmode="email" [(ngModel)]="email" required /></div>
      <div class="field"><label for="password">Password</label>
        <input id="password" name="password" class="input" type="password" autocomplete="current-password" [(ngModel)]="password" required /></div>
      @if (error()) { <div class="banner bad small" role="alert">{{ error() }}</div> }
      @if (success()) { <div class="banner good small" role="status">{{ success() }}</div> }
      <button class="btn primary big block" type="submit" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign In' }}</button>
      @if (!demo) {
        <button class="btn big block" type="button" (click)="google()" [disabled]="busy()">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Google Sign In</button>
      }
      <div class="row between small"><a routerLink="/forgot-password">Forgot Password?</a><a routerLink="/register">Create Account</a></div>
    </form>
  </main>`,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  net = inject(NetService);
  demo = environment.backend === 'memory';
  email = '';
  password = '';
  busy = signal(false);
  error = signal('');
  success = signal('');

  private async done() {
    this.success.set('Signed in. Opening your plan…');
    const next = this.route.snapshot.queryParamMap.get('next');
    await this.router.navigateByUrl(next && next.startsWith('/') ? next : '/app/today');
  }
  async submit() {
    this.error.set('');
    if (!EMAIL.test(this.email.trim())) return this.error.set('Enter a valid email address.');
    if (!this.password) return this.error.set('Enter your password.');
    this.busy.set(true);
    try { await this.auth.signIn(this.email, this.password); await this.done(); }
    catch (e) { this.error.set(friendly(e)); }
    finally { this.busy.set(false); }
  }
  async google() {
    this.error.set('');
    this.busy.set(true);
    try { await this.auth.google(); await this.done(); }
    catch (e) { this.error.set(friendly(e)); }
    finally { this.busy.set(false); }
  }
}

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink, PublicNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav />
  <main class="page narrow">
    <form class="card stack" (ngSubmit)="submit()" novalidate>
      <h1>Create your account</h1>
      <div class="field"><label for="name">Name</label><input id="name" name="name" class="input" autocomplete="name" [(ngModel)]="f.name" required /></div>
      <div class="field"><label for="email">Email</label><input id="email" name="email" class="input" type="email" autocomplete="email" [(ngModel)]="f.email" required /></div>
      <div class="field"><label for="pw">Password</label><input id="pw" name="pw" class="input" type="password" autocomplete="new-password" [(ngModel)]="f.pw" required minlength="8" />
        <span class="hint">At least 8 characters, with a letter and a number.</span></div>
      <div class="field"><label for="pw2">Confirm Password</label><input id="pw2" name="pw2" class="input" type="password" autocomplete="new-password" [(ngModel)]="f.pw2" required /></div>
      <details><summary class="small" style="cursor:pointer">Optional: target and study time</summary>
        <div class="stack" style="margin-top:10px">
          <div class="field"><label for="role">Target Role</label><input id="role" name="role" class="input" [(ngModel)]="f.role" placeholder="Senior Full-Stack Developer" /></div>
          <div class="field"><label for="sal">Target Salary</label><input id="sal" name="sal" class="input" [(ngModel)]="f.salary" placeholder="e.g. ₹10 LPA+" /></div>
          <div class="grid two">
            <div class="field"><label for="mins">Daily Study Time (min)</label><input id="mins" name="mins" class="input" type="number" min="15" max="300" [(ngModel)]="f.minutes" /></div>
            <div class="field"><label for="time">Preferred Study Time</label><input id="time" name="time" class="input" type="time" [(ngModel)]="f.time" /></div>
          </div>
        </div>
      </details>
      @if (error()) { <div class="banner bad small" role="alert">{{ error() }}</div> }
      <button class="btn primary big block" type="submit" [disabled]="busy()">{{ busy() ? 'Creating account…' : 'Create Account' }}</button>
      <p class="small center">Already have an account? <a routerLink="/login">Sign in</a></p>
      <p class="xs muted center">By creating an account you accept the <a routerLink="/terms">terms</a> and <a routerLink="/privacy">privacy notice</a>.</p>
    </form>
  </main>`,
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private users = inject(UserService);
  private router = inject(Router);
  f = { name: '', email: '', pw: '', pw2: '', role: '', salary: '', minutes: 45, time: '19:00' };
  busy = signal(false);
  error = signal('');

  async submit() {
    const f = this.f;
    this.error.set('');
    if (f.name.trim().length < 2) return this.error.set('Enter your name.');
    if (!EMAIL.test(f.email.trim())) return this.error.set('Enter a valid email address.');
    if (f.pw.length < 8 || !/[a-z]/i.test(f.pw) || !/\d/.test(f.pw)) return this.error.set('Password needs at least 8 characters including a letter and a number.');
    if (f.pw !== f.pw2) return this.error.set('The two passwords do not match.');
    this.busy.set(true);
    try {
      await this.auth.register(f.email, f.pw, f.name);
      try {
        await this.users.createInitialProfile({ displayName: f.name.trim(), targetRole: f.role.trim() || undefined, targetSalary: f.salary.trim() || undefined, dailyMinutes: +f.minutes || undefined, preferredTime: f.time || undefined });
      } catch { /* onboarding will create it */ }
      await this.router.navigateByUrl('/onboarding');
    } catch (e) {
      this.error.set(friendly(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-forgot',
  imports: [FormsModule, RouterLink, PublicNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav />
  <main class="page narrow">
    <form class="card stack" (ngSubmit)="submit()" novalidate>
      <h1>Reset your password</h1>
      <p class="small muted">Enter your account email. We'll send a link to set a new password.</p>
      <div class="field"><label for="email">Email</label><input id="email" name="email" class="input" type="email" autocomplete="email" [(ngModel)]="email" /></div>
      @if (error()) { <div class="banner bad small" role="alert">{{ error() }}</div> }
      @if (sent()) { <div class="banner good small" role="status">If an account exists for {{ email }}, a reset link is on its way. Check your inbox and spam folder.</div> }
      <button class="btn primary big block" type="submit" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send reset link' }}</button>
      <a class="small" routerLink="/login">← Back to sign in</a>
    </form>
  </main>`,
})
export class ForgotPasswordComponent {
  private auth = inject(AuthService);
  email = '';
  busy = signal(false);
  error = signal('');
  sent = signal(false);
  async submit() {
    this.error.set('');
    this.sent.set(false);
    if (!EMAIL.test(this.email.trim())) return this.error.set('Enter a valid email address.');
    this.busy.set(true);
    try {
      await this.auth.sendReset(this.email);
      this.sent.set(true);
    } catch (e) {
      // do not reveal whether an account exists
      if ((e as { code?: string }).code === 'auth/user-not-found') this.sent.set(true);
      else this.error.set(friendly(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * /reset-password?mode=resetPassword&oobCode=…  (set this page as the custom action URL in Firebase
 * Auth → Templates, see SETUP.md). Also handles mode=verifyEmail.
 */
@Component({
  selector: 'app-reset',
  imports: [FormsModule, RouterLink, PublicNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav />
  <main class="page narrow">
    <div class="card stack">
      @switch (state()) {
        @case ('checking') { <div class="row"><div class="spinner"></div><span>Checking your link…</span></div> }
        @case ('invalid') {
          <h1>Link not valid</h1><div class="banner bad small">{{ error() }}</div>
          <a class="btn primary" routerLink="/forgot-password">Request a new link</a>
        }
        @case ('verified') { <h1>Email verified</h1><p>Your email address is confirmed.</p><a class="btn primary" routerLink="/app/today">Continue</a> }
        @case ('done') { <h1>Password updated</h1><div class="banner good small">You can now sign in with your new password.</div><a class="btn primary" routerLink="/login">Sign in</a> }
        @case ('nocode') {
          <h1>Reset password</h1><p class="small muted">Open this page from the link in the reset email. Need a new email?</p>
          <a class="btn primary" routerLink="/forgot-password">Send reset link</a>
        }
        @default {
          <form class="stack" (ngSubmit)="submit()" novalidate>
            <h1>Choose a new password</h1>
            <p class="small muted">For {{ email() }}</p>
            <div class="field"><label for="pw">New password</label><input id="pw" name="pw" class="input" type="password" autocomplete="new-password" [(ngModel)]="pw" /></div>
            <div class="field"><label for="pw2">Confirm new password</label><input id="pw2" name="pw2" class="input" type="password" autocomplete="new-password" [(ngModel)]="pw2" /></div>
            @if (error()) { <div class="banner bad small" role="alert">{{ error() }}</div> }
            <button class="btn primary big block" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save new password' }}</button>
          </form>
        }
      }
    </div>
  </main>`,
})
export class ResetPasswordComponent implements OnInit {
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  state = signal<'checking' | 'form' | 'invalid' | 'done' | 'verified' | 'nocode'>('checking');
  email = signal('');
  error = signal('');
  busy = signal(false);
  pw = '';
  pw2 = '';
  private code = '';

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    this.code = q.get('oobCode') || '';
    const mode = q.get('mode') || 'resetPassword';
    if (!this.code) return this.state.set('nocode');
    try {
      if (mode === 'verifyEmail') { await this.auth.applyCode(this.code); await this.auth.reload().catch(() => undefined); this.state.set('verified'); return; }
      this.email.set(await this.auth.verifyResetCode(this.code));
      this.state.set('form');
    } catch (e) {
      this.error.set(friendly(e));
      this.state.set('invalid');
    }
  }
  async submit() {
    this.error.set('');
    if (this.pw.length < 8 || !/[a-z]/i.test(this.pw) || !/\d/.test(this.pw)) return this.error.set('Password needs at least 8 characters including a letter and a number.');
    if (this.pw !== this.pw2) return this.error.set('The two passwords do not match.');
    this.busy.set(true);
    try { await this.auth.confirmReset(this.code, this.pw); this.state.set('done'); }
    catch (e) { this.error.set(friendly(e)); }
    finally { this.busy.set(false); }
  }
}
