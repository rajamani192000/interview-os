import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { DATA_STORE, INCREMENT, SERVER_TIME } from '../data/store';
import {
  accessNow, DailyUsage, DateOverride, effectiveFor, fromLegacy, nextAvailable, ScheduleChange, summarize, validateOverride, validateWeekly,
  WeeklySchedule, zonedNow,
} from '../logic/schedule';
import { clean } from '../util';
import { AuthService } from './auth.service';
import { ClockService } from './platform.service';
import { LoadState, SettingsService } from './user.service';

export const deviceTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/**
 * ScheduleService: weekly schedule, calendar overrides, usage and the live access decision.
 * Everything is read from / written to Firestore under users/{uid}; the effective schedule is
 * recalculated every 30 s and whenever data changes (midnight rollover, edits while practising).
 */
@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  private settings = inject(SettingsService);
  private clock = inject(ClockService);

  readonly weekly = signal<WeeklySchedule | null>(null);
  readonly overrides = signal<Record<string, DateOverride>>({});
  readonly usedSeconds = signal(0); // today's usage (server value + unsaved local seconds)
  readonly usageDate = signal('');
  readonly history = signal<ScheduleChange[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  /** ticks every 30 s so time-of-day and midnight changes are picked up */
  readonly tick = signal(Date.now());
  private loadedFor: string | null = null;
  private pending: Promise<void> | null = null;

  constructor() {
    setInterval(() => this.tick.set(Date.now()), 30_000);
    effect(() => { if (!this.auth.uid()) { this.weekly.set(null); this.overrides.set({}); this.usedSeconds.set(0); this.loadedFor = null; this.state.set('idle'); } });
    // midnight (in the schedule's time zone): switch the usage document
    effect(() => {
      this.tick();
      const w = this.weekly();
      if (!w || !this.loadedFor) return;
      const d = this.now().date;
      if (this.usageDate() && d !== this.usageDate()) this.loadUsage(d).catch(() => undefined);
    });
  }

  private get uid() { return this.auth.uid()!; }
  private base() { return `users/${this.uid}`; }

  tz(): string { return this.weekly()?.timezone || deviceTimeZone(); }
  now() { this.tick(); return zonedNow(this.tz(), new Date(this.clock.now())); }
  /** The device is in a different zone than the schedule was saved in. */
  readonly tzMismatch = computed(() => { const w = this.weekly(); return !!w && w.timezone !== deviceTimeZone(); });

  readonly today = computed(() => {
    const w = this.weekly();
    if (!w) return null;
    const n = this.now();
    return effectiveFor(n.date, w, this.overrides());
  });
  readonly access = computed(() => {
    const w = this.weekly(), e = this.today();
    if (!w || !e) return null;
    const n = this.now();
    return accessNow(e, n.minutes, this.usedSeconds(), w.enforce, nextAvailable(n.date, w, this.overrides()));
  });

  ensureLoaded(force = false): Promise<void> {
    const uid = this.auth.uid();
    if (!uid) return Promise.resolve();
    if (!force && this.loadedFor === uid && this.state() === 'ready') return Promise.resolve();
    if (this.pending) return this.pending;
    this.state.set('loading');
    this.pending = this.load()
      .then(() => { this.loadedFor = uid; this.state.set('ready'); })
      .catch(e => { this.error.set((e as Error).message || 'Could not load your schedule'); this.state.set('error'); throw e; })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  private async load() {
    await this.settings.ensureLoaded();
    let w = await this.store.get<WeeklySchedule>(`${this.base()}/schedule/weekly`);
    if (!w) {
      // Safe migration: existing users keep their single daily value as every day's limit.
      const s = this.settings.settings();
      w = fromLegacy(s.dailyMinutes, s.studyDays, deviceTimeZone());
      await this.store.set(`${this.base()}/schedule/weekly`, clean({ ...w, updatedAt: SERVER_TIME }));
      await this.logChange({ kind: 'migration', summary: `Created from your daily setting: ${summarize(w)}` });
    }
    this.weekly.set(w);
    const today = zonedNow(w.timezone || deviceTimeZone(), new Date(this.clock.now())).date;
    const rows = await this.store.list<DateOverride>(`${this.base()}/scheduleOverrides`, { where: [['date', '>=', addDaysKey(today, -1)]], orderBy: [['date', 'asc']], limit: 400 });
    this.overrides.set(Object.fromEntries(rows.map(r => [r.date || r.id, { ...r, date: r.date || r.id }])));
    await this.loadUsage(today);
  }

  private async loadUsage(date: string) {
    const u = await this.store.get<DailyUsage>(`${this.base()}/usage/${date}`);
    this.usageDate.set(date);
    this.usedSeconds.set(Math.max(0, u?.seconds || 0));
  }

  /** Saves the weekly schedule; also keeps settings.studyDays in sync for plans and reminders. */
  async saveWeekly(w: WeeklySchedule) {
    const v = validateWeekly(w);
    if (v.errors.length) throw new Error(v.errors[0]);
    const before = this.weekly();
    const next: WeeklySchedule = { ...w, updatedAt: Date.now() };
    await this.store.set(`${this.base()}/schedule/weekly`, clean({ ...next, updatedAt: SERVER_TIME }));
    this.weekly.set(next);
    const studyDays = [0, 1, 2, 3, 4, 5, 6].filter(d => (w.mode === 'same' ? w.default : w.days[String(d)] || w.default).enabled);
    await this.settings.save({ studyDays: studyDays.length ? studyDays : this.settings.settings().studyDays }).catch(() => undefined);
    await this.logChange({ kind: 'weekly', summary: `${before ? 'Changed' : 'Set'} weekly schedule: ${summarize(next)}${next.enforce ? '' : ' (not enforced)'}` });
    return v.warnings;
  }

  async saveOverride(o: DateOverride) {
    const today = this.now().date;
    const v = validateOverride(o, today, []);
    if (v.errors.length) throw new Error(v.errors[0]);
    const data = clean({ ...o, createdAt: SERVER_TIME });
    await this.store.set(`${this.base()}/scheduleOverrides/${o.date}`, data);
    this.overrides.update(m => ({ ...m, [o.date]: { ...o, createdAt: Date.now() } }));
    await this.logChange({ kind: 'override-add', date: o.date, summary: `Override ${o.date}: ${o.kind === 'disabled' ? 'no practice' : o.kind === 'unlimited' ? 'unlimited' : `${o.start}–${o.end}, ${o.limitMinutes === null ? 'unlimited' : o.limitMinutes + ' min'}`}${o.note ? ' — ' + o.note : ''}` });
    return v.warnings;
  }

  async removeOverride(date: string) {
    await this.store.delete(`${this.base()}/scheduleOverrides/${date}`);
    this.overrides.update(m => { const c = { ...m }; delete c[date]; return c; });
    await this.logChange({ kind: 'override-remove', date, summary: `Removed override for ${date}` });
  }

  private async logChange(c: ScheduleChange) {
    const id = this.store.newId(`${this.base()}/scheduleHistory`);
    await this.store.set(`${this.base()}/scheduleHistory/${id}`, clean({ ...c, createdAt: SERVER_TIME })).catch(() => undefined);
    this.history.update(h => [{ ...c, id, createdAt: Date.now() }, ...h].slice(0, 50));
  }

  async loadHistory() {
    const rows = await this.store.list<ScheduleChange>(`${this.base()}/scheduleHistory`, { orderBy: [['createdAt', 'desc']], limit: 50 });
    this.history.set(rows);
  }

  /** Adds practice seconds to today's usage (atomic increment in Firestore). */
  async addUsage(seconds: number) {
    if (!this.auth.uid() || seconds <= 0) return;
    const date = this.now().date;
    if (this.usageDate() !== date) await this.loadUsage(date).catch(() => undefined);
    this.usedSeconds.update(s => s + seconds);
    await this.store.set(`${this.base()}/usage/${date}`, { date, seconds: INCREMENT(seconds), updatedAt: SERVER_TIME }, true);
  }

  async usageRange(from: string): Promise<DailyUsage[]> {
    return this.store.list<DailyUsage>(`${this.base()}/usage`, { where: [['date', '>=', from]], orderBy: [['date', 'asc']], limit: 400 });
  }
}

function addDaysKey(key: string, n: number) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Practice screens whose time counts towards (and is controlled by) the schedule. */
export const PRACTICE_ROUTES = ['/app/practice', '/app/communication', '/app/voice', '/app/mock-interview'];
export const isPracticeUrl = (url: string) => PRACTICE_ROUTES.some(r => url === r || url.startsWith(r + '?') || url.startsWith(r + '/'));

/**
 * UsageService: counts active practice time. Time counts only while a practice screen is open,
 * the tab is visible and there was user activity in the last 2 minutes. Flushed to Firestore
 * every 60 s (and when leaving the screen / hiding the tab).
 */
@Injectable({ providedIn: 'root' })
export class UsageService {
  private schedule = inject(ScheduleService);
  private router = inject(Router);
  private auth = inject(AuthService);
  private pendingSec = 0;
  private lastActivity = Date.now();
  private started = false;
  readonly onPractice = signal(false);

  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.onPractice.set(isPracticeUrl(this.router.url));
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      const was = this.onPractice();
      this.onPractice.set(isPracticeUrl((e as NavigationEnd).urlAfterRedirects));
      if (was && !this.onPractice()) this.flush();
    });
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']) window.addEventListener(ev, () => (this.lastActivity = Date.now()), { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
    window.addEventListener('pagehide', () => this.flush());
    setInterval(() => this.second(), 1000);
  }

  private second() {
    if (!this.auth.uid() || !this.onPractice() || document.visibilityState !== 'visible') return;
    if (Date.now() - this.lastActivity > 120_000) return; // idle
    const a = this.schedule.access();
    if (a && !a.allowed) return; // blocked screens don't count
    this.pendingSec++;
    this.schedule.usedSeconds.update(s => s + 1); // live display; persisted in flush()
    if (this.pendingSec >= 60) this.flush();
  }

  flush() {
    const s = this.pendingSec;
    if (!s) return;
    this.pendingSec = 0;
    this.schedule.usedSeconds.update(x => x - s); // addUsage adds it back
    this.schedule.addUsage(s).catch(() => undefined);
  }
}
