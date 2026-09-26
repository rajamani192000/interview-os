import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DATA_STORE, SERVER_TIME } from '../core/data/store';
import { statusOf } from '../core/logic/srs';
import { SRS_STATUSES, SrsStatus } from '../core/models';
import { AuthService } from '../core/services/auth.service';
import { CategoryService, MasterDataStore } from '../core/services/master-data.service';
import { ClockService } from '../core/services/platform.service';
import { AttemptService, RevisionService } from '../core/services/practice.service';
import { ProgressService } from '../core/services/progress.service';
import { CommunicationService, MockInterviewService, VoiceInterviewService } from '../core/services/speaking.service';
import { addDays, errorMessage } from '../core/util';
import { UI } from '../shared/ui';

@Component({
  selector: 'app-revision',
  imports: [RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Revision" subtitle="Spaced repetition on your questions: 1 → 3 → 7 → 14 → 30 → 60 days (admin-configurable)">
      @if (due().length) { <a class="btn primary" routerLink="/app/practice" [queryParams]="{ source: 'revision' }">Revise due ({{ due().length }})</a> }
    </app-page-header>
    @if (state() === 'loading') { <app-loading /> }
    @else if (state() === 'error') { <app-error [message]="err()" (retry)="load()" /> }
    @else if (!revision.items().length) {
      <app-empty title="Nothing scheduled yet" text="Every question you practise gets a revision date automatically.">
        <a class="btn primary" routerLink="/app/today">Start today's plan</a>
      </app-empty>
    } @else {
      <div class="tabs">
        <button class="chip" [class.on]="!filter()" (click)="filter.set(null)">All ({{ revision.items().length }})</button>
        @for (s of statuses; track s) { @if (s !== 'New') { <button class="chip" [class.on]="filter() === s" (click)="filter.set(s)">{{ s }} ({{ counts()[s] }})</button> } }
      </div>
      @if (!due().length) { <div class="banner good small">No revision due today. Next items are listed below.</div> }
      <section class="card stack">
        <h3>Next 7 days</h3>
        <div class="bar-chart" style="height:60px">@for (d of week(); track d.day) { <span [class.zero]="!d.n" [style.height.%]="max() ? (d.n / max()) * 100 : 0" [title]="d.day + ': ' + d.n"></span> }</div>
        <div class="row between xs muted">@for (d of week(); track d.day) { <span>{{ d.label }}<br />{{ d.n }}</span> }</div>
      </section>
      <section class="card list" style="padding:4px 12px">
        @for (s of list(); track s.questionId) {
          <a class="list-item clickable" [routerLink]="['/app/questions', s.questionId]" style="color:var(--text);text-decoration:none">
            <div class="grow stack" style="gap:2px"><span class="small">{{ md.questionMap().get(s.questionId)?.question || 'Archived question' }}</span>
              <span class="xs muted">{{ cats.name(s.categoryId) }} · due {{ s.dueDate }} · ✓{{ s.correct || 0 }} ✗{{ s.incorrect || 0 }} · {{ s.reps }} reviews</span></div>
            <app-status [status]="statusOf(s)" />
          </a>
        } @empty { <p class="small muted">No questions with this status.</p> }
      </section>
    }
  </div>`,
})
export class RevisionComponent implements OnInit {
  revision = inject(RevisionService);
  md = inject(MasterDataStore);
  cats = inject(CategoryService);
  private clock = inject(ClockService);
  statuses = SRS_STATUSES;
  state = signal<'loading' | 'ready' | 'error'>('loading');
  err = signal('');
  filter = signal<SrsStatus | null>(null);
  due = computed(() => this.revision.due());
  counts = computed(() => this.revision.counts());
  list = computed(() => {
    const t = this.clock.today();
    const f = this.filter();
    return [...this.revision.items()].filter(s => !f || statusOf(s, t) === f).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 200);
  });
  week = computed(() => {
    const t = this.clock.today();
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(t, i);
      const n = this.revision.items().filter(s => (i === 0 ? s.dueDate <= day : s.dueDate === day)).length;
      return { day, n, label: i === 0 ? 'Today' : new Date(day + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' }) };
    });
  });
  max = computed(() => Math.max(...this.week().map(d => d.n)));
  statusOf = (s: Parameters<typeof statusOf>[0]) => statusOf(s, this.clock.today());

  ngOnInit() { this.load(); }
  async load() {
    this.state.set('loading');
    try { await Promise.all([this.md.ensureLoaded(), this.revision.ensureLoaded(true)]); this.state.set('ready'); }
    catch (e) { this.err.set(errorMessage(e)); this.state.set('error'); }
  }
}

/**
 * Weak areas combine: low scores / incorrect answers, low confidence, repeated failures (lapses),
 * old overdue revisions, communication problems and low-scoring voice/mock answers.
 * The computed result is stored at users/{uid}/progress/weakAreas for history and other devices.
 */
@Component({
  selector: 'app-weak-areas',
  imports: [RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Weak Areas" subtitle="Calculated from your last 60 days of attempts, revisions, speaking and interviews">
      @if (weakQuestionCount()) { <a class="btn primary" routerLink="/app/practice" [queryParams]="{ source: 'weak' }">Practise weak questions</a> }
    </app-page-header>
    @if (loading()) { <app-loading /> }
    @else if (err()) { <app-error [message]="err()" (retry)="load()" /> }
    @else {
      <div class="tabs"><button class="chip" [class.on]="level() === 'topic'" (click)="level.set('topic')">By topic</button><button class="chip" [class.on]="level() === 'category'" (click)="level.set('category')">By category</button></div>
      @if (!areas().length) {
        <app-empty title="No weak areas detected" [text]="progress.attempts.items().length ? 'Your recent scores are 70%+ everywhere you practised. Keep revising.' : 'Weak areas appear after you practise some questions.'">
          <a class="btn primary" routerLink="/app/today">Go to Today</a></app-empty>
      }
      @for (w of areas(); track w.key) {
        <article class="card stack">
          <div class="row between"><div><b>{{ w.name }}</b> @if (w.categoryName) { <span class="xs muted">{{ w.categoryName }}</span> }</div><span class="badge bad">severity {{ w.severity }}</span></div>
          <app-bar [value]="100 - w.severity" />
          <div class="small muted">Avg score {{ w.avgScore }}% · confidence {{ w.avgConfidence }}/5 · {{ w.attempts }} attempts · {{ w.weakQuestions }} weak questions · {{ w.lapses }} repeated misses</div>
          @if (w.questionIds.length) { <div><a class="btn sm" routerLink="/app/practice" [queryParams]="{ ids: w.questionIds.slice(0, 10).join(',') }">Practise {{ Math.min(10, w.questionIds.length) }} questions</a></div> }
        </article>
      }
      <div class="grid two">
        <section class="card stack">
          <h3>Old revisions</h3>
          @if (oldOverdue()) { <p class="small" style="margin:0">{{ oldOverdue() }} question(s) are more than 7 days overdue.</p><div><a class="btn sm" routerLink="/app/practice" [queryParams]="{ source: 'revision' }">Revise now</a></div> }
          @else { <p class="small muted" style="margin:0">Nothing badly overdue.</p> }
        </section>
        <section class="card stack">
          <h3>Communication</h3>
          @if (commIssues().length) { @for (c of commIssues(); track c) { <div class="small">• {{ c }}</div> } <div><a class="btn sm" routerLink="/app/communication">Speaking drill</a></div> }
          @else { <p class="small muted" style="margin:0">No speaking issues detected{{ progress.comm.items().length ? '' : ' (no drills yet)' }}.</p> }
        </section>
        <section class="card stack">
          <h3>Interview answers</h3>
          @if (interviewMisses().length) { @for (m of interviewMisses(); track m.q) { <div class="small">• {{ m.q }} <span class="muted">({{ m.score }})</span></div> } }
          @else { <p class="small muted" style="margin:0">No low-scoring voice or mock answers in the last 60 days.</p> }
        </section>
      </div>
    }
  </div>`,
})
export class WeakAreasComponent implements OnInit {
  progress = inject(ProgressService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private comm = inject(CommunicationService);
  private voice = inject(VoiceInterviewService);
  private mocks = inject(MockInterviewService);
  private md = inject(MasterDataStore);
  private clock = inject(ClockService);
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  Math = Math;
  loading = signal(true);
  err = signal('');
  level = signal<'topic' | 'category'>('topic');
  areas = computed(() => { this.attempts.items(); this.revision.items(); return this.progress.weak(this.level()); });
  weakQuestionCount = computed(() => this.revision.items().filter(s => s.status === 'Weak').length);
  oldOverdue = computed(() => { const cut = addDays(this.clock.today(), -7); return this.revision.items().filter(s => s.dueDate < cut).length; });
  commIssues = computed(() => {
    const recent = this.comm.items().filter(c => c.date >= addDays(this.clock.today(), -60));
    if (!recent.length) return [];
    const out: string[] = [];
    const fill = recent.reduce((n, c) => n + (c.metrics?.fillers || 0), 0) / recent.length;
    const wpm = recent.map(c => c.metrics?.wpm).filter((x): x is number => !!x);
    if (fill >= 4) out.push(`Filler words: ${fill.toFixed(1)} per drill on average`);
    if (wpm.length && wpm.reduce((a, b) => a + b, 0) / wpm.length > 165) out.push('Speaking pace is fast (over 165 words/min)');
    const dims: Record<string, number[]> = {};
    recent.forEach(c => Object.entries(c.ratings || {}).forEach(([k, v]) => v && (dims[k] ||= []).push(v)));
    Object.entries(dims).forEach(([k, v]) => { const a = v.reduce((x, y) => x + y, 0) / v.length; if (a < 3) out.push(`Self-rated ${k}: ${a.toFixed(1)}/5`); });
    return out;
  });
  interviewMisses = computed(() => {
    const from = addDays(this.clock.today(), -60);
    return [...this.voice.items().filter(v => v.date >= from).flatMap(v => v.turns), ...this.mocks.items().filter(m => m.date >= from).flatMap(m => m.turns)]
      .filter(t => t.score < 50).slice(0, 6).map(t => ({ q: t.question.slice(0, 90), score: t.score }));
  });

  ngOnInit() { this.load(); }
  async load() {
    this.loading.set(true);
    this.err.set('');
    try {
      await Promise.all([this.md.ensureLoaded(), this.attempts.ensureLoaded(), this.revision.ensureLoaded(), this.comm.ensureLoaded(), this.voice.ensureLoaded(), this.mocks.ensureLoaded()]);
      this.saveSnapshot();
    } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  /** Stores the calculated state (at most one write per day). */
  private saveSnapshot() {
    const key = 'ios.weak.saved';
    const today = this.clock.today();
    try { if (localStorage.getItem(key) === today + this.auth.uid()) return; } catch { /* ignore */ }
    const topics = this.progress.weak('topic').slice(0, 15).map(w => ({ topicId: w.key, name: w.name, severity: w.severity, avgScore: w.avgScore, attempts: w.attempts }));
    this.store.set(`users/${this.auth.uid()}/progress/weakAreas`, { date: today, topics, communication: this.commIssues(), updatedAt: SERVER_TIME })
      .then(() => { try { localStorage.setItem(key, today + this.auth.uid()); } catch { /* ignore */ } })
      .catch(() => undefined);
  }
}
