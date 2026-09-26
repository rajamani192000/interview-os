import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { DATA_STORE, SERVER_TIME } from '../data/store';
import { buildPlan, missedStudyDays, planProgress } from '../logic/plan';
import { weakAreas } from '../logic/weak';
import { DailyPlan, PlanItem, StudySession } from '../models';
import { addDays, clean, daysBetween } from '../util';
import { InterviewService } from './career.service';
import { ScheduleService } from './schedule.service';
import { AuthService } from './auth.service';
import { UserCollection } from './collection';
import { CategoryService, MasterDataStore, TopicService } from './master-data.service';
import { ClockService } from './platform.service';
import { AttemptService, BookmarkService, RevisionService } from './practice.service';
import { LoadState, SettingsService, UserService } from './user.service';

/** users/{uid}/studySessions */
@Injectable({ providedIn: 'root' })
export class StudySessionService extends UserCollection<StudySession> {
  private clock = inject(ClockService);
  constructor() { super('studySessions', { where: [['date', '>=', addDays(new Date().toISOString().slice(0, 10), -366)]], orderBy: [['date', 'desc']], limit: 3000 }); }
  private active: { startedAt: number; questions: number; kind: StudySession['kind'] } | null = null;

  begin(kind: StudySession['kind']) {
    if (!this.active) this.active = { startedAt: this.clock.now(), questions: 0, kind };
  }
  countQuestion() {
    if (this.active) this.active.questions++;
  }
  /** Saves the session if at least one question was done or a minute passed. Caps idle time at 90 min. */
  async end() {
    const a = this.active;
    this.active = null;
    if (!a) return;
    const minutes = Math.min(90, Math.round((this.clock.now() - a.startedAt) / 60000));
    if (!a.questions && minutes < 1) return;
    await this.save({ date: this.clock.today(), startedAt: a.startedAt, endedAt: this.clock.now(), minutes: Math.max(1, minutes), questions: a.questions, kind: a.kind });
  }
  minutesToday() {
    const t = this.clock.today();
    return this.items().filter(s => s.date === t).reduce((n, s) => n + s.minutes, 0);
  }
}

/** users/{uid}/dailyPlans/{yyyy-mm-dd}: the plan is generated once per day and stored, so every device shows the same plan. */
@Injectable({ providedIn: 'root' })
export class DailyPlanService {
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  private clock = inject(ClockService);
  private md = inject(MasterDataStore);
  private cats = inject(CategoryService);
  private topics = inject(TopicService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private bookmarks = inject(BookmarkService);
  private settings = inject(SettingsService);
  private user = inject(UserService);
  private sessions = inject(StudySessionService);
  private interviews = inject(InterviewService);
  private schedule = inject(ScheduleService);

  readonly plan = signal<DailyPlan | null>(null);
  readonly history = signal<DailyPlan[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  readonly progress = computed(() => planProgress(this.plan()));
  private pending: Promise<void> | null = null;

  constructor() {
    effect(() => { if (!this.auth.uid()) { this.plan.set(null); this.history.set([]); this.state.set('idle'); } });
  }

  private path(date: string) {
    return `users/${this.auth.uid()}/dailyPlans/${date}`;
  }

  /** Loads (or generates) today's plan. Regenerates automatically when the date changed. */
  ensureToday(): Promise<void> {
    const today = this.clock.today();
    if (this.plan()?.date === today && this.state() === 'ready') return Promise.resolve();
    if (this.pending) return this.pending;
    this.state.set('loading');
    this.pending = this.load(today)
      .then(() => this.state.set('ready'))
      .catch(e => { this.error.set((e as Error).message || 'Could not load today’s plan'); this.state.set('error'); })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  private async deps() {
    await Promise.all([this.md.ensureLoaded(), this.revision.ensureLoaded(), this.attempts.ensureLoaded(), this.bookmarks.ensureLoaded(), this.settings.ensureLoaded(), this.user.ensureLoaded(), this.sessions.ensureLoaded(), this.interviews.ensureLoaded(), this.schedule.ensureLoaded().catch(() => undefined)]);
  }

  private async load(today: string) {
    const existing = await this.store.get<DailyPlan>(this.path(today));
    const qTypes = ['revision', 'weak', 'new'];
    // keep the stored plan, unless it was made while the bank was empty and questions exist now
    if (existing && (existing.items.some(i => qTypes.includes(i.type) || i.done))) { this.plan.set(existing); return; }
    await this.deps();
    if (existing && !this.md.questions().length) { this.plan.set(existing); return; }
    const p = this.generate(today);
    if (!this.md.questions().length) { this.plan.set(p); return; } // empty bank: show, but don't store
    await this.store.set(this.path(today), clean({ ...p, generatedAt: SERVER_TIME }));
    this.plan.set({ ...p, generatedAt: Date.now() });
  }

  /** Today's plan size: the daily target, capped by today's scheduled practice limit (if any). */
  private budget(target: number): number {
    const t = this.schedule.today();
    if (!t || !t.enabled || t.limitMinutes === null) return target;
    return Math.max(15, Math.min(target, t.limitMinutes));
  }

  /** Nearest upcoming interview: tracked interview rounds first, then the goal's date. */
  nextInterviewDate(): string | undefined {
    const t = this.clock.today();
    const dates = [this.interviews.next()?.date, this.user.goal().interviewDate].filter((d): d is string => !!d && d >= t).sort();
    return dates[0];
  }

  lastStudyDay(before: string): string | undefined {
    // activity today counts: someone who already studied today is not "returning after a break"
    const days = [...this.attempts.items().map(a => a.date), ...this.sessions.items().map(s => s.date)].filter(d => d <= before).sort();
    return days[days.length - 1];
  }

  missedDays(): number {
    const t = this.clock.today();
    return missedStudyDays(this.lastStudyDay(t), t, this.settings.settings().studyDays);
  }

  private generate(today: string, keep: PlanItem[] = [], forceRecovery = false): DailyPlan {
    const s = this.settings.settings();
    const g = this.user.goal();
    const weak = weakAreas(this.attempts.items(), this.revision.items(), this.topics.list(), this.cats.list(), 'topic', 60, today);
    const weakIds = [
      ...this.revision.items().filter(x => x.status === 'Weak').sort((a, b) => b.lapses - a.lapses).map(x => x.questionId),
      ...weak.flatMap(w => w.questionIds),
    ];
    const p = buildPlan({
      today,
      dailyMinutes: this.budget(s.dailyMinutes),
      newPerDay: s.newPerDay,
      voiceEnabled: s.voice.enabled,
      questions: this.md.questions(),
      schedules: this.revision.items(),
      weakQuestionIds: [...new Set(weakIds)],
      focusCategoryIds: g.focusCategoryIds,
      interviewTomorrowIds: this.bookmarks.withTag('Interview Tomorrow'),
      lastStudyDay: forceRecovery ? addDays(today, -30) : this.lastStudyDay(today),
      studyDays: forceRecovery ? [0, 1, 2, 3, 4, 5, 6] : s.studyDays,
      interviewDate: forceRecovery ? undefined : this.nextInterviewDate(),
    });
    // job requirements: an interview for a tracked job within 7 days adds a job-prep item
    const next = this.interviews.next();
    if (!forceRecovery && next?.jobId && daysBetween(today, next.date) <= 7 && !p.items.some(i => i.type === 'job-prep')) {
      p.items.push({ id: `job-prep-${next.jobId}`, type: 'job-prep', refId: next.jobId, title: `Prepare for ${next.company} (${next.round}): review JD gaps`, minutes: 10, done: false });
      p.minutesPlanned += 10;
    }
    const done = keep.filter(i => i.done);
    if (done.length) {
      // Rebuilding mid-day: keep finished work, don't repeat it, and only add what still fits the budget.
      const doneMinutes = done.reduce((n, i) => n + i.minutes, 0);
      const doneRefs = new Set(done.map(i => i.refId).filter(Boolean));
      const doneTypes = new Set(done.filter(i => !i.refId).map(i => i.type));
      // a finished day stays finished (unless the user explicitly asks for a recovery session)
      let left = forceRecovery ? Infinity : keep.every(i => i.done) ? 0 : Math.max(0, this.budget(s.dailyMinutes) - doneMinutes);
      const extra = p.items.filter(i => {
        if (i.refId ? doneRefs.has(i.refId) : doneTypes.has(i.type)) return false;
        if (i.minutes > left) return false;
        left -= i.minutes;
        return true;
      });
      p.items = [...done, ...extra];
      p.minutesPlanned = p.items.reduce((n, i) => n + i.minutes, 0);
    }
    return p;
  }

  /** Rebuilds today's plan (e.g. after settings change), keeping completed items. */
  async regenerate(forceRecovery = false) {
    await this.deps();
    const today = this.clock.today();
    // never lose completed items: load today's stored plan first if this page hasn't yet
    if (this.plan()?.date !== today) {
      const stored = await this.store.get<DailyPlan>(this.path(today)).catch(() => null);
      if (stored) this.plan.set(stored);
    }
    const p = this.generate(today, this.plan()?.date === today ? this.plan()!.items : [], forceRecovery);
    await this.store.set(this.path(today), clean({ ...p, generatedAt: SERVER_TIME, startedAt: this.plan()?.startedAt }));
    this.plan.set({ ...p, generatedAt: Date.now(), startedAt: this.plan()?.startedAt });
  }

  async start() {
    const p = this.plan();
    if (!p || p.startedAt) return;
    const startedAt = this.clock.now();
    this.plan.set({ ...p, startedAt });
    await this.store.set(this.path(p.date), { startedAt }, true);
  }

  async markDone(itemId: string, done = true) {
    const p = this.plan();
    if (!p) return;
    const items = p.items.map(i => (i.id === itemId ? clean({ ...i, done, doneAt: done ? this.clock.now() : undefined }) : i));
    const complete = items.every(i => i.done);
    const next: DailyPlan = clean({ ...p, items, completedAt: complete ? p.completedAt || this.clock.now() : undefined });
    this.plan.set(next);
    await this.store.set(this.path(p.date), clean({ items, completedAt: next.completedAt ?? null }), true);
  }

  /** Marks the first open plan item matching a practised question / activity. */
  async completeMatching(type: PlanItem['type'] | 'question', refId?: string) {
    const p = this.plan();
    if (!p || p.date !== this.clock.today()) return;
    const item = p.items.find(i => !i.done && (type === 'question' ? i.refId === refId : i.type === type && (!refId || i.refId === refId)));
    if (item) await this.markDone(item.id);
  }

  /**
   * Focus protection: planned study days in the last `days` days (excluding today) and how many of
   * them reached the minimum commitment (or had a completed plan / any attempt).
   */
  consistency(days = 7): { planned: number; completed: number; missed: number } {
    const t = this.clock.today();
    const s = this.settings.settings();
    const minutes = new Map<string, number>();
    this.sessions.items().forEach(x => minutes.set(x.date, (minutes.get(x.date) || 0) + x.minutes));
    const attempted = new Set(this.attempts.items().map(a => a.date));
    const planDone = new Set(this.history().filter(p => p.items.length && p.items.every(i => i.done)).map(p => p.date));
    // only days since the user started (account creation or first activity) can be "planned"
    const created = this.user.profile()?.createdAt;
    const firstActivity = [...attempted, ...minutes.keys()].sort()[0];
    const start = [created ? new Date(created).toISOString().slice(0, 10) : undefined, firstActivity].filter((x): x is string => !!x).sort()[0] || t;
    let planned = 0, completed = 0;
    for (let i = 1; i <= days; i++) {
      const d = addDays(t, -i);
      if (d < start) break;
      const [y, m, dd] = d.split('-').map(Number);
      if (!s.studyDays.includes(new Date(y, m - 1, dd).getDay())) continue;
      planned++;
      if (planDone.has(d) || (minutes.get(d) || 0) >= s.minMinutes || attempted.has(d)) completed++;
    }
    return { planned, completed, missed: planned - completed };
  }

  async loadHistory(days = 90) {
    const from = addDays(this.clock.today(), -days);
    const rows = await this.store.list<DailyPlan>(`users/${this.auth.uid()}/dailyPlans`, { where: [['date', '>=', from]], orderBy: [['date', 'desc']], limit: 400 });
    this.history.set(rows);
    return rows;
  }
}
