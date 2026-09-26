import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppNotification } from '../core/models';
import { NotificationService } from '../core/services/notification.service';
import { ToastService } from '../core/services/platform.service';
import { SettingsService } from '../core/services/user.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

@Component({
  selector: 'app-notifications',
  imports: [RouterLink, DatePipe, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    <app-page-header title="Notifications">@if (svc.unread()) { <button class="btn sm" (click)="readAll()">Mark all read</button> }</app-page-header>
    <section class="card stack">
      <div class="row between"><b>System notifications</b>
        <span class="badge {{ svc.permission() === 'granted' ? 'good' : svc.permission() === 'denied' ? 'bad' : 'warn' }}">{{ permLabel() }}</span></div>
      @switch (svc.permission()) {
        @case ('default') { <p class="small muted" style="margin:0">Allow notifications so reminders can appear outside the app.</p><div><button class="btn primary" (click)="ask()">Allow notifications</button></div> }
        @case ('denied') { <p class="small muted" style="margin:0">Notifications are blocked for this site. Re-enable them in your browser's site settings; reminders will still appear in this inbox.</p> }
        @case ('unsupported') { <p class="small muted" style="margin:0">This browser doesn't support notifications. On iPhone, add the app to the Home Screen first (iOS 16.4+).</p> }
        @default { <div class="row"><button class="btn sm" (click)="test()">Send a test notification</button><a class="btn sm ghost" routerLink="/app/settings" [queryParams]="{ tab: 'reminders' }">Reminder settings</a></div> }
      }
      <p class="xs muted" style="margin:0">Mode: <b>{{ settings.settings().reminders.mode }}</b>{{ settings.settings().reminders.enabled ? '' : ' (off)' }} · quiet {{ settings.settings().reminders.quietStart }}–{{ settings.settings().reminders.quietEnd }} · max {{ settings.settings().reminders.maxPerDay }}/day. Browser reminders are checked while the app is open or recently used; they cannot ring like a native alarm. Push reminders when the app is closed need the optional Cloud Function (see SETUP.md).</p>
    </section>
    @if (svc.state() === 'loading' && !svc.items().length) { <app-loading /> }
    @else if (svc.state() === 'error') { <app-error [message]="svc.error()" (retry)="svc.ensureLoaded(true)" /> }
    @else if (!svc.items().length) { <app-empty title="No notifications" text="Reminders and interview alerts will appear here." /> }
    @else {
      <section class="card list" style="padding:4px 12px">
        @for (n of svc.items(); track n.id) {
          <button class="list-item clickable" style="background:none;border:0;border-bottom:1px solid var(--border);font:inherit;color:inherit;text-align:left" (click)="open(n)">
            <span aria-hidden="true">{{ n.read ? '○' : '●' }}</span>
            <span class="grow stack" style="gap:0"><b class="small">{{ n.title }}</b><span class="small muted">{{ n.body }}</span></span>
            <span class="xs muted nowrap">{{ n.createdAt | date: 'd MMM, HH:mm' }}</span>
          </button>
        }
      </section>
    }
  </div>`,
})
export class NotificationsComponent implements OnInit {
  svc = inject(NotificationService);
  settings = inject(SettingsService);
  private toast = inject(ToastService);
  private router = inject(Router);
  busy = signal(false);
  permLabel = computed(() => ({ granted: 'Allowed', denied: 'Blocked', default: 'Not asked yet', unsupported: 'Not supported' })[this.svc.permission()]);
  ngOnInit() { this.svc.ensureLoaded(true).catch(() => undefined); }
  async ask() { const p = await this.svc.requestPermission(); this.toast.show(p === 'granted' ? 'Notifications allowed' : 'Notifications not allowed'); }
  async test() { try { await this.svc.notify('Test reminder', 'Notifications are working.', { kind: 'system' }); } catch (e) { this.toast.bad(errorMessage(e)); } }
  async readAll() { try { await this.svc.markAllRead(); } catch (e) { this.toast.bad(errorMessage(e)); } }
  async open(n: AppNotification & { id: string }) {
    if (!n.read) this.svc.patch(n.id, { read: true }).catch(() => undefined);
    if (n.link) this.router.navigateByUrl('/' + n.link.replace(/^\//, ''));
  }
}
