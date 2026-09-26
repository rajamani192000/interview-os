import { inject, Injectable, signal } from '@angular/core';
import { DATA_STORE } from '../data/store';
import { earned, AchievementStats } from '../logic/achievements';
import { Analytics, computeAnalytics, Range, streaks } from '../logic/analytics';
import { toCsv } from '../logic/importer';
import { weakAreas, WeakArea } from '../logic/weak';
import { Achievement } from '../models';
import { addDays, downloadFile } from '../util';
import { AuthService } from './auth.service';
import { JobService } from './career.service';
import { UserCollection } from './collection';
import { CategoryService, MasterDataStore, TopicService } from './master-data.service';
import { DailyPlanService, StudySessionService } from './plan.service';
import { ClockService } from './platform.service';
import { AttemptService, NoteService, RevisionService } from './practice.service';
import { CommunicationService, MockInterviewService, VoiceInterviewService } from './speaking.service';
import { SettingsService, UserService } from './user.service';

@Injectable({ providedIn: 'root' })
export class AchievementService extends UserCollection<Achievement> {
  constructor() { super('achievements'); }
}

/** ProgressService: analytics, weak areas, streaks, achievements and data export. */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  private clock = inject(ClockService);
  private md = inject(MasterDataStore);
  private cats = inject(CategoryService);
  private topics = inject(TopicService);
  readonly attempts = inject(AttemptService);
  readonly revision = inject(RevisionService);
  readonly sessions = inject(StudySessionService);
  readonly plans = inject(DailyPlanService);
  readonly voice = inject(VoiceInterviewService);
  readonly comm = inject(CommunicationService);
  readonly mocks = inject(MockInterviewService);
  readonly jobs = inject(JobService);
  readonly achievements = inject(AchievementService);
  private notes = inject(NoteService);
  private user = inject(UserService);
  private settings = inject(SettingsService);
  readonly loading = signal(false);

  async loadAll() {
    this.loading.set(true);
    try {
      await Promise.all([
        this.md.ensureLoaded(), this.attempts.ensureLoaded(), this.revision.ensureLoaded(), this.sessions.ensureLoaded(), this.voice.ensureLoaded(),
        this.comm.ensureLoaded(), this.mocks.ensureLoaded(), this.jobs.ensureLoaded(), this.achievements.ensureLoaded(), this.plans.loadHistory(90),
      ]);
    } finally {
      this.loading.set(false);
    }
  }

  analytics(range: Range): Analytics {
    return computeAnalytics(range, this.clock.today(), {
      attempts: this.attempts.items(), sessions: this.sessions.items(), plans: this.plans.history(), voice: this.voice.items(),
      comm: this.comm.items(), mocks: this.mocks.items(), schedules: this.revision.items(),
    });
  }

  weak(level: 'topic' | 'category' = 'topic'): WeakArea[] {
    return weakAreas(this.attempts.items(), this.revision.items(), this.topics.list(), this.cats.list(), level, 60, this.clock.today());
  }

  streak() {
    const days = new Set([...this.attempts.items().map(a => a.date), ...this.sessions.items().map(s => s.date)]);
    const p = this.plans.plan();
    if (p?.items.some(i => i.done)) days.add(p.date);
    return streaks(days, this.clock.today());
  }

  /**
   * Readiness by area (0..100, null = no data yet). Area score blends recent accuracy with how much
   * of that area's bank is Strong/Mastered, so it can't be gamed by practising 2 easy questions.
   */
  readiness(): { key: string; label: string; value: number | null; note: string }[] {
    const t = this.clock.today();
    const from = addDays(t, -30);
    const qs = this.md.questions();
    const cat = (id: string) => this.cats.name(id).toLowerCase();
    const area = (q: { type: string; categoryId: string }) =>
      q.type === 'Coding' || /coding/.test(cat(q.categoryId)) ? 'coding' : q.type === 'System Design' || /architect|design/.test(cat(q.categoryId)) ? 'design' : q.type === 'Behavioral' ? 'hr' : 'technical';
    const sched = this.revision.map();
    const recent = this.attempts.items().filter(a => a.date >= from);
    const qmap = this.md.questionMap();
    const areaScore = (k: string) => {
      const bank = qs.filter(q => area(q) === k);
      const att = recent.filter(a => { const q = qmap.get(a.questionId); return q && area(q) === k; });
      if (!bank.length || att.length < 5) return null; // not enough evidence yet
      const avg = att.reduce((n, a) => n + a.score, 0) / att.length;
      const strong = bank.filter(q => ['Strong', 'Mastered'].includes(sched.get(q.id)?.status || '')).length / bank.length;
      return Math.round(avg * 0.6 + strong * 100 * 0.4);
    };
    const comm = this.comm.items().filter(c => c.date >= from);
    const voice = this.voice.items().filter(v => v.date >= from);
    const commParts = [
      ...comm.map(c => { const r = Object.values(c.ratings || {}).filter(Boolean) as number[]; return r.length ? (r.reduce((a, b) => a + b, 0) / r.length) * 20 : c.selfRating * 20; }),
      ...voice.map(v => v.communicationScore ?? v.overall),
    ];
    const scheduled = this.revision.items();
    const overdue = scheduled.filter(s => s.dueDate < t).length;
    const cons = this.plans.consistency(30);
    const mocks = this.mocks.items().filter(m => m.status === 'completed' && m.overall !== undefined);
    const out = [
      { key: 'technical', label: 'Technical', value: areaScore('technical'), note: 'Needs 5+ answers in 30 days. Blends recent scores with share of Strong/Mastered questions' },
      { key: 'coding', label: 'Coding', value: areaScore('coding'), note: 'Coding questions' },
      { key: 'design', label: 'System Design', value: areaScore('design'), note: 'Architecture and design questions' },
      { key: 'communication', label: 'Communication', value: commParts.length >= 2 ? Math.round(commParts.reduce((a, b) => a + b, 0) / commParts.length) : null, note: 'Speaking drills and voice interviews' },
      { key: 'revision', label: 'Revision', value: scheduled.length >= 5 ? Math.round((1 - overdue / scheduled.length) * 100) : null, note: 'Share of scheduled questions not overdue' },
      { key: 'consistency', label: 'Consistency', value: cons.planned >= 3 ? Math.round((cons.completed / cons.planned) * 100) : null, note: 'Planned days completed (30 days)' },
      { key: 'mock', label: 'Mock interviews', value: mocks.length ? Math.round(mocks.slice(0, 5).reduce((n, m) => n + (m.overall || 0), 0) / Math.min(5, mocks.length)) : null, note: 'Last 5 completed mocks' },
    ];
    const vals = out.map(o => o.value).filter((v): v is number => v !== null);
    return [{ key: 'overall', label: 'Overall preparation', value: vals.length >= 2 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, note: 'Average of the areas with enough data (shown once 2+ areas have data)' }, ...out];
  }

  /** Awards achievements that the recorded data now satisfies. Returns newly earned ones. */
  async checkAchievements(): Promise<Achievement[]> {
    await Promise.all([this.achievements.ensureLoaded(), this.attempts.ensureLoaded(), this.revision.ensureLoaded()]);
    const st = this.streak();
    const hist = this.plans.history().length ? this.plans.history() : [];
    const today = this.plans.plan();
    const allPlans = today && !hist.some(h => h.date === today.date) ? [today, ...hist] : hist;
    const stats: AchievementStats = {
      attempts: this.attempts.items().length,
      distinctQuestions: new Set(this.attempts.items().map(a => a.questionId)).size,
      mastered: this.revision.items().filter(s => s.status === 'Mastered').length,
      currentStreak: st.current,
      bestStreak: st.best,
      plansCompleted: allPlans.filter(p => p.items.length && p.items.every(i => i.done)).length,
      recoveryCompleted: allPlans.filter(p => p.mode === 'recovery' && p.items.every(i => i.done)).length,
      voiceSessions: this.voice.items().length,
      commSessions: this.comm.items().length,
      mocks: this.mocks.items().filter(m => m.status === 'completed').length,
      jobsApplied: this.jobs.items().filter(j => j.status !== 'Saved').length,
    };
    const have = new Set(this.achievements.items().map(a => a.id));
    const fresh = earned(stats, have).map(a => ({ id: a.id, title: a.title, earnedAt: this.clock.now() }));
    for (const a of fresh) await this.achievements.save(a, a.id);
    return fresh;
  }

  /** Exports all of the user's own data (not master data) as JSON. */
  async exportJson() {
    const uid = this.auth.uid()!;
    const names = ['attempts', 'revisionSchedules', 'dailyPlans', 'studySessions', 'communicationSessions', 'voiceSessions', 'mockInterviews', 'bookmarks', 'notes', 'jobs', 'interviews', 'projects', 'achievements', 'notifications', 'schedule', 'scheduleOverrides', 'usage', 'scheduleHistory'];
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), app: 'Interview OS', profile: this.user.profile(), settings: this.settings.settings(), goal: this.user.goal() };
    for (const n of names) out[n] = await this.store.list(`users/${uid}/${n}`);
    downloadFile(`interview-os-export-${this.clock.today()}.json`, JSON.stringify(out, null, 2));
  }

  /** CSV exports of the most useful tables. */
  async exportCsv(kind: 'attempts' | 'jobs' | 'progress' | 'notes') {
    const q = (id: string) => this.md.questionMap().get(id);
    if (kind === 'attempts') {
      await this.attempts.ensureLoaded();
      const rows = this.attempts.items().map(a => ({ date: a.date, category: this.cats.name(a.categoryId), topic: this.topics.name(a.topicId), question: q(a.questionId)?.question, mode: a.mode, rating: a.rating, score: a.score, confidence: a.confidence, seconds: a.durationSec }));
      downloadFile(`attempts-${this.clock.today()}.csv`, toCsv(rows), 'text/csv');
    } else if (kind === 'jobs') {
      await this.jobs.ensureLoaded();
      const rows = this.jobs.items().map(j => ({ company: j.company, title: j.title, status: j.status, location: j.location, appliedOn: j.appliedOn, nextAction: j.nextAction, nextActionDate: j.nextActionDate, url: j.url, salaryNote: j.salaryNote, skills: j.skills }));
      downloadFile(`jobs-${this.clock.today()}.csv`, toCsv(rows), 'text/csv');
    } else if (kind === 'notes') {
      await this.notes.ensureLoaded();
      const rows = this.notes.items().map(n => ({ title: n.title, question: n.questionId ? q(n.questionId)?.question : '', body: n.body, tags: n.tags }));
      downloadFile(`notes-${this.clock.today()}.csv`, toCsv(rows), 'text/csv');
    } else {
      await this.revision.ensureLoaded();
      const rows = this.revision.items().map(s => ({ question: q(s.questionId)?.question, category: this.cats.name(s.categoryId), topic: this.topics.name(s.topicId), status: s.status, dueDate: s.dueDate, reps: s.reps, lapses: s.lapses, lastReviewed: s.lastReviewed }));
      downloadFile(`progress-${this.clock.today()}.csv`, toCsv(rows), 'text/csv');
    }
  }

  /** Deletes every document under users/{uid} (used by "Delete my data" and account deletion). */
  async deleteAllUserData() {
    const uid = this.auth.uid()!;
    const names = ['attempts', 'revisionSchedules', 'dailyPlans', 'studySessions', 'communicationSessions', 'voiceSessions', 'mockInterviews', 'bookmarks', 'notes', 'jobs', 'interviews', 'projects', 'achievements', 'notifications', 'settings', 'goals', 'devices', 'schedule', 'scheduleOverrides', 'usage', 'scheduleHistory', 'progress'];
    for (const n of names) {
      const rows = await this.store.list<{ id: string }>(`users/${uid}/${n}`);
      if (rows.length) await this.store.batch(rows.map(r => ({ type: 'delete' as const, path: `users/${uid}/${n}/${r.id}` })));
    }
    await this.store.delete(`users/${uid}`);
  }
}
