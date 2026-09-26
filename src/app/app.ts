import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { NetService } from './core/services/platform.service';
import { ToastsComponent } from './shell/shell';

/** Root: shows a splash while Firebase restores the session (no flash of the login page). */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (!auth.ready()) {
      <div class="center" style="padding-top:30vh" role="status"><div class="spinner" style="margin:0 auto 12px"></div><span class="muted small">Loading…</span>
        @if (!net.online()) { <p class="small muted">You're offline. Opening your saved session…</p> }</div>
    }
    <router-outlet />
    <app-toasts />`,
})
export class App {
  auth = inject(AuthService);
  net = inject(NetService);
}
