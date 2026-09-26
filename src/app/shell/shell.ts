import { ChangeDetectionStrategy, Component, computed, inject, input, OnDestroy, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../environments/environment';
import { AppConfigService } from '../core/services/app-config.service';
import { AuthService } from '../core/services/auth.service';
import { NotificationService } from '../core/services/notification.service';
import { NetService, ToastService } from '../core/services/platform.service';
import { UserService } from '../core/services/user.service';

export interface NavItem { path: string; label: string; icon: string; }
export const APP_NAV: NavItem[] = [
  { path: '/app/dashboard', label: 'Dashboard', icon: '▦' },
  { path: '/app/today', label: 'Today', icon: '☀' },
  { path: '/app/questions', label: 'Questions', icon: '❓' },
  { path: '/app/revision', label: 'Revision', icon: '↻' },
  { path: '/app/weak-areas', label: 'Weak Areas', icon: '◎' },
  { path: '/app/communication', label: 'Communication', icon: '💬' },
  { path: '/app/voice', label: 'Voice Interview', icon: '🎙' },
  { path: '/app/mock-interview', label: 'Mock Interview', icon: '🧑‍💼' },
  { path: '/app/jobs', label: 'Jobs', icon: '💼' },
  { path: '/app/projects', label: 'Projects', icon: '🗂' },
  { path: '/app/notes', label: 'Notes', icon: '📝' },
  { path: '/app/progress', label: 'Progress', icon: '📈' },
  { path: '/app/notifications', label: 'Notifications', icon: '🔔' },
  { path: '/app/settings', label: 'Settings', icon: '⚙' },
];
export const ADMIN_NAV: NavItem[] = [
  { path: '/admin', label: 'Admin home', icon: '🛡' },
  { path: '/admin/questions', label: 'Questions', icon: '❓' },
  { path: '/admin/categories', label: 'Categories', icon: '🏷' },
  { path: '/admin/topics', label: 'Topics', icon: '🔖' },
  { path: '/admin/settings', label: 'System settings', icon: '⚙' },
];
const BOTTOM: NavItem[] = [
  { path: '/app/today', label: 'Today', icon: '☀' },
  { path: '/app/revision', label: 'Revise', icon: '↻' },
  { path: '/app/voice', label: 'Voice', icon: '🎙' },
  { path: '/app/mock-interview', label: 'Mock', icon: '🧑‍💼' },
  { path: '/app/progress', label: 'Progress', icon: '📈' },
];

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="toasts" aria-live="polite">
    @for (t of toast.toasts(); track t.id) {
      <div class="toast {{ t.kind }}" role="status"><span>{{ t.text }}</span>
        <span class="row">@if (t.action) { <button class="btn sm" (click)="t.action.run(); toast.dismiss(t.id)">{{ t.action.label }}</button> }
        <button class="btn ghost sm" style="color:#fff" (click)="toast.dismiss(t.id)" aria-label="Dismiss">✕</button></span></div>
    }
  </div>`,
})
export class ToastsComponent {
  toast = inject(ToastService);
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .layout { display: grid; grid-template-columns: 1fr; min-height: 100vh; }
    aside { display: none; }
    @media (min-width: 900px) {
      .layout { grid-template-columns: 236px 1fr; }
      aside { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 0; height: 100vh; overflow-y: auto; padding: 14px 10px; border-right: 1px solid var(--border); background: var(--surface); }
      .bottom { display: none !important; }
    }
    .nav-link { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-radius: 10px; color: var(--text); font-weight: 500; text-decoration: none !important; }
    .nav-link:hover { background: var(--surface-2); }
    .nav-link.active { background: var(--primary-soft); color: var(--primary); font-weight: 700; }
    .nav-link .ic { width: 22px; text-align: center; }
    header.top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
    .bottom { position: fixed; bottom: 0; left: 0; right: 0; z-index: 30; display: grid; grid-template-columns: repeat(6, 1fr); background: var(--surface); border-top: 1px solid var(--border); padding-bottom: env(safe-area-inset-bottom); }
    .bottom a, .bottom button { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 2px; font-size: 0.7rem; color: var(--muted); background: none; border: 0; font-family: inherit; text-decoration: none !important; min-height: 56px; justify-content: center; cursor: pointer; }
    .bottom .active { color: var(--primary); font-weight: 700; }
    .bottom .ic { font-size: 1.2rem; line-height: 1; }
    .drawer { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,.4); }
    .drawer > div { position: absolute; right: 0; top: 0; bottom: 0; width: min(300px, 86vw); background: var(--surface); padding: 14px 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
    .dot { background: var(--bad); color: #fff; border-radius: 99px; font-size: 0.7rem; padding: 0 6px; font-weight: 700; }
  `,
  template: `<div class="layout">
    <aside aria-label="Sidebar">
      <a routerLink="/app/today" class="row" style="gap:8px;padding:6px 10px 14px;color:var(--text);text-decoration:none"><img src="icons/icon-192.png" width="28" height="28" alt="" /><b>Interview OS</b></a>
      @for (n of nav(); track n.path) {
        <a class="nav-link" [routerLink]="n.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: n.path === '/admin' }"><span class="ic">{{ n.icon }}</span>{{ n.label }}
          @if (n.path === '/app/notifications' && notif.unread()) { <span class="dot">{{ notif.unread() }}</span> }</a>
      }
      <div style="margin-top:auto;padding-top:12px;border-top:1px solid var(--border)" class="stack">
        @if (auth.isAdmin()) { <a class="nav-link" [routerLink]="admin() ? '/app/today' : '/admin'"><span class="ic">{{ admin() ? '←' : '🛡' }}</span>{{ admin() ? 'Back to app' : 'Admin' }}</a> }
        <div class="small muted" style="padding:0 12px">{{ user.profile()?.displayName || auth.user()?.email }}</div>
        <button class="btn ghost sm" (click)="signOut()">Sign out</button>
      </div>
    </aside>
    <div style="min-width:0">
      <header class="top">
        <b class="grow">{{ admin() ? 'Admin' : title() }}</b>
        @if (!net.online()) { <span class="badge warn" title="Changes are saved on this device and sync when you reconnect">Offline</span> }
        @if (demo) { <span class="badge warn">Demo mode</span> }
        <a class="btn ghost sm" routerLink="/app/notifications" aria-label="Notifications">🔔 @if (notif.unread()) { <span class="dot">{{ notif.unread() }}</span> }</a>
      </header>
      @if (config.config().announcement) { <div class="page" style="padding-bottom:0"><div class="banner info small">{{ config.config().announcement }}</div></div> }
      @if (!auth.user()?.emailVerified && auth.user()?.provider === 'password' && !verifyHidden()) {
        <div class="page" style="padding-bottom:0"><div class="banner warn small row between"><span>Please verify your email address (check your inbox).</span>
          <span class="row"><button class="btn sm" (click)="resend()">Resend</button><button class="btn ghost sm" (click)="verifyHidden.set(true)">Hide</button></span></div></div>
      }
      <main><router-outlet /></main>
    </div>
  </div>
  <nav class="bottom" aria-label="Bottom navigation">
    @for (n of bottom; track n.path) { <a [routerLink]="n.path" routerLinkActive="active"><span class="ic">{{ n.icon }}</span>{{ n.label }}</a> }
    <button (click)="drawer.set(true)" aria-label="More"><span class="ic">☰</span>More @if (notif.unread()) { <span class="dot">{{ notif.unread() }}</span> }</button>
  </nav>
  @if (drawer()) {
    <div class="drawer" (click)="drawer.set(false)"><div (click)="$event.stopPropagation()" role="dialog" aria-label="Menu">
      @for (n of nav(); track n.path) { <a class="nav-link" [routerLink]="n.path" routerLinkActive="active" (click)="drawer.set(false)"><span class="ic">{{ n.icon }}</span>{{ n.label }}</a> }
      @if (auth.isAdmin()) { <a class="nav-link" [routerLink]="admin() ? '/app/today' : '/admin'" (click)="drawer.set(false)"><span class="ic">🛡</span>{{ admin() ? 'Back to app' : 'Admin' }}</a> }
      <button class="btn block" style="margin-top:12px" (click)="signOut()">Sign out</button>
    </div></div>
  }
`,
})
export class ShellComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  user = inject(UserService);
  net = inject(NetService);
  notif = inject(NotificationService);
  config = inject(AppConfigService);
  private toast = inject(ToastService);
  private router = inject(Router);
  admin = input(false);
  demo = environment.backend === 'memory';
  drawer = signal(false);
  verifyHidden = signal(false);
  url = signal(this.router.url);
  nav = computed(() => (this.admin() ? ADMIN_NAV : APP_NAV));
  bottom = BOTTOM;
  title = computed(() => (this.url().startsWith('/app/practice') ? 'Practice' : APP_NAV.find(n => this.url().startsWith(n.path))?.label ?? 'Interview OS'));
  private sub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => this.url.set((e as NavigationEnd).urlAfterRedirects));

  ngOnInit() {
    this.config.ensureLoaded();
    this.notif.ensureLoaded().catch(() => undefined);
    this.notif.startLoop();
    if (this.router.url.includes('denied=admin')) this.toast.bad('That area is for administrators only.');
  }
  ngOnDestroy() {
    this.sub.unsubscribe();
    this.notif.stopLoop();
  }
  async resend() {
    try { await this.auth.sendVerification(); this.toast.good('Verification email sent.'); } catch { this.toast.bad('Could not send the email. Try again later.'); }
  }
  signOut() {
    this.auth.signOut();
  }
}
