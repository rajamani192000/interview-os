import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { decideReminder } from '../logic/reminders';
import { AppNotification } from '../models';
import { hashText } from '../util';
import { InterviewService } from './career.service';
import { UserCollection } from './collection';
import { AppConfigService } from './app-config.service';
import { DailyPlanService } from './plan.service';
import { ClockService } from './platform.service';
import { SettingsService, UserService } from './user.service';

interface LocalReminderState { day: string; sent: number; lastSentAt?: number; snoozedUntil?: number; snoozes?: number; }
const LS = 'ios.reminder.v1';

/**
 * NotificationService
 *  - in-app inbox: users/{uid}/notifications
 *  - reminders: checked while the app is open or running in the background (browser permitting),
 *    shown as system notifications via the service worker
 *  - FCM push (optional, Blaze): registers this device's token in users/{uid}/devices; the scheduled
 *    Cloud Function in /functions sends reminders even when the app is closed.
 * A web app cannot ring like a native alarm clock; this is stated in Settings.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService extends UserCollection<AppNotification> {
  private settings = inject(SettingsService);
  private plan = inject(DailyPlanService);
  private clock = inject(ClockService);
  private interviews = inject(InterviewService);
  private user = inject(UserService);
  private config = inject(AppConfigService);
  /** snoozes today (focus tracking) */
  readonly snoozes = signal(0);
  readonly permission = signal<NotificationPermission | 'unsupported'>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  readonly pushStatus = signal<'off' | 'registered' | 'unsupported' | 'error'>('off');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super('notifications', { orderBy: [['createdAt', 'desc']], limit: 100 });
  }

  unread() {
    return this.items().filter(n => !n.read).length;
  }

  async requestPermission() {
    if (typeof Notification === 'undefined') return 'unsupported' as const;
    const p = await Notification.requestPermission();
    this.permission.set(p);
    if (p === 'granted') this.registerPush().catch(() => undefined);
    return p;
  }

  private local(): LocalReminderState {
    const today = this.clock.today();
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}') as LocalReminderState;
      return s.day === today ? s : { day: today, sent: 0, snoozedUntil: s.snoozedUntil };
    } catch {
      return { day: today, sent: 0 };
    }
  }
  private saveLocal(s: LocalReminderState) {
    try { localStorage.setItem(LS, JSON.stringify(s)); } catch { /* ignore */ }
  }

  snooze(minutes?: number) {
    const s = this.local();
    s.snoozedUntil = this.clock.now() + (minutes ?? this.settings.settings().reminders.snoozeMinutes) * 60000;
    s.snoozes = (s.snoozes || 0) + 1;
    this.snoozes.set(s.snoozes);
    this.saveLocal(s);
  }

  /** Starts the in-app reminder loop (every 5 minutes + when the tab becomes visible). */
  startLoop() {
    if (this.timer || typeof window === 'undefined') return;
    const run = () => this.check().catch(() => undefined);
    this.timer = setInterval(run, 5 * 60000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && run());
    navigator.serviceWorker?.addEventListener('message', e => {
      if (e.data?.type === 'snooze') this.snooze();
    });
    setTimeout(run, 15000);
  }
  stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async check() {
    if (!this.auth.uid()) return;
    await this.plan.ensureToday();
    const s = this.settings.settings();
    const st = this.local();
    const next = this.interviews.next();
    const pr = this.plan.progress();
    const d = decideReminder(s, {
      now: this.clock.date(), today: this.clock.today(), planComplete: pr.total > 0 && pr.complete, planStarted: pr.done > 0, minutesDone: pr.minutesDone,
      sentToday: st.sent, lastSentAt: st.lastSentAt, snoozedUntil: st.snoozedUntil,
      interviewDate: next?.date ?? this.user.goal().interviewDate, isStudyDay: s.studyDays.includes(this.clock.date().getDay()),
    }, this.config.config().templates);
    if (!d.send) this.snoozes.set(st.snoozes || 0);
    if (!d.send || !d.title) return;
    st.sent++;
    st.lastSentAt = this.clock.now();
    this.saveLocal(st);
    await this.notify(d.title, d.body || '', { urgent: d.urgent, link: 'app/today', kind: 'reminder' });
  }

  /** Shows a system notification (if permitted) and stores it in the inbox. */
  async notify(title: string, body: string, o: { urgent?: boolean; link?: string; kind?: AppNotification['kind'] } = {}) {
    if (this.permission() === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body, tag: 'ios-' + (o.kind || 'reminder'), icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', requireInteraction: !!o.urgent, data: { link: o.link || 'app/today' }, actions: [{ action: 'open', title: 'Start' }, { action: 'snooze', title: 'Snooze' }] } as NotificationOptions;
      if (reg) await reg.showNotification(title, opts).catch(() => undefined);
      else new Notification(title, opts);
    }
    await this.save({ title, body, kind: o.kind || 'system', read: false, link: o.link }).catch(() => undefined);
  }

  async markAllRead() {
    const unread = this.items().filter(n => !n.read);
    if (!unread.length) return;
    this.items.update(l => l.map(n => ({ ...n, read: true })));
    await this.store.batch(unread.map(n => ({ type: 'update' as const, path: `${this.coll()}/${n.id}`, data: { read: true } })));
  }

  /** FCM registration (only when enabled in environment and supported by the browser). */
  async registerPush() {
    if (!environment.features.messaging || !environment.fcmVapidKey || !environment.firebase.appId || environment.backend !== 'firebase') { this.pushStatus.set('off'); return; }
    try {
      const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
      if (!(await isSupported())) { this.pushStatus.set('unsupported'); return; }
      const { firebaseApp } = await import('../data/firebase-backend');
      const reg = await navigator.serviceWorker.getRegistration();
      const token = await getToken(getMessaging(firebaseApp()), { vapidKey: environment.fcmVapidKey, serviceWorkerRegistration: reg });
      if (!token) { this.pushStatus.set('error'); return; }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await this.store.set(`users/${this.uid}/devices/${hashText(token)}`, { token, tz, ua: navigator.userAgent.slice(0, 120), updatedAt: Date.now() });
      this.pushStatus.set('registered');
    } catch {
      this.pushStatus.set('error');
    }
  }
}
