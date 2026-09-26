import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ACHIEVEMENTS } from '../core/logic/achievements';
import { Range } from '../core/logic/analytics';
import { SRS_STATUSES } from '../core/models';
import { CategoryService } from '../core/services/master-data.service';
import { ToastService } from '../core/services/platform.service';
import { ProgressService } from '../core/services/progress.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

/** Single-series bar chart: one hue, rounded data-ends on the baseline, 2px gaps, per-bar hover label. */
@Component({
  selector: 'app-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .chart { display: flex; align-items: flex-end; gap: 2px; height: 120px; border-bottom: 1px solid var(--border); position: relative; }
    .col { flex: 1; height: 100%; display: flex; align-items: flex-end; position: relative; cursor: default; }
    .col .bar { width: 100%; background: var(--primary); border-radius: 4px 4px 0 0; min-height: 0; }
    .col:hover .bar, .col:focus .bar { opacity: .75; }
    .col .tip { display: none; position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); font-size: .72rem; padding: 3px 7px; border-radius: 6px; white-space: nowrap; z-index: 2; pointer-events: none; }
    .col:hover .tip, .col:focus .tip { display: block; }
    .axis { display: flex; justify-content: space-between; font-size: .7rem; color: var(--muted); margin-top: 4px; }
  `,
  template: `<div class="chart" role="img" [attr.aria-label]="label">
      @for (p of points; track $index) {
        <div class="col" tabindex="0"><div class="bar" [style.height.%]="max ? (p.v / max) * 100 : 0"></div><span class="tip">{{ p.x }}: {{ p.v }}{{ unit }}</span></div>
      }
    </div>
    <div class="axis"><span>{{ points[0]?.x }}</span><span>{{ points[points.length - 1]?.x }}</span></div>`,
  inputs: ['points', 'label', 'unit'],
})
export class BarsComponent {
  points: { x: string; v: number }[] = [];
  label = '';
  unit = '';
  get max() { return Math.max(0, ...this.points.map(p => p.v)); }
}

@Component({
  selector: 'app-progress',
  imports: [RouterLink, DatePipe, BarsComponent, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Progress" subtitle="Everything below is calculated from your Firestore data" />
    <div class="tabs">@for (r of ranges; track r.v) { <button class="chip" [class.on]="range() === r.v" (click)="range.set(r.v)">{{ r.label }}</button> }</div>
    @if (loading()) { <app-loading [rows]="6" /> }
    @else if (err()) { <app-error [message]="err()" (retry)="load()" /> }
    @else if (!a().attempts && !a().voiceSessions && !a().commSessions) {
      <app-empty title="No activity in this period" text="Practise a few questions and your progress appears here."><a class="btn primary" routerLink="/app/today">Start today's plan</a></app-empty>
    } @else {
      <div class="grid stats">
        @for (r of readiness(); track r.key) {
          <div class="card slim stack" style="gap:4px" [title]="r.note"><span class="eyebrow">{{ r.label }}</span><b style="font-size:1.25rem">{{ r.value === null ? '—' : r.value + '%' }}</b>@if (r.value === null) { <span class="xs muted">not enough data yet</span> }<app-bar [value]="r.value ?? 0" /></div>
        }
      </div>
      <div class="grid stats">
        <div class="card slim stat"><span class="eyebrow">Questions attempted</span><b>{{ a().attempts }}</b><span class="xs muted">{{ a().questions }} different</span></div>
        <div class="card slim stat"><span class="eyebrow">Accuracy</span><b>{{ a().avgScore }}%</b><span class="xs muted">avg confidence {{ avgConfidence() }}/5</span></div>
        <div class="card slim stat"><span class="eyebrow">Study minutes</span><b>{{ a().minutes }}</b><span class="xs muted">{{ a().activeDays }} active days</span></div>
        <div class="card slim stat"><span class="eyebrow">Daily completion</span><b>{{ a().plansCompleted }}</b><span class="xs muted">full plans · streak {{ a().currentStreak }} (best {{ a().bestStreak }})</span></div>
        <div class="card slim stat"><span class="eyebrow">Revision completion</span><b>{{ revisionRate() }}%</b><span class="xs muted">scheduled items not overdue</span></div>
        <div class="card slim stat"><span class="eyebrow">Communication</span><b>{{ a().commSessions }}</b><span class="xs muted">{{ a().avgWpm ? a().avgWpm + ' wpm' : '' }}{{ a().fillersPerSession !== null ? ' · ' + a().fillersPerSession + ' fillers/drill' : '' }}</span></div>
        <div class="card slim stat"><span class="eyebrow">Voice sessions</span><b>{{ a().voiceSessions }}</b><span class="xs muted">{{ a().avgVoice !== null ? 'avg ' + a().avgVoice : '' }}</span></div>
        <div class="card slim stat"><span class="eyebrow">Mock interviews</span><b>{{ a().mocks }}</b><span class="xs muted">completed</span></div>
      </div>
      <div class="grid two">
        <section class="card stack"><h3>Questions attempted per day</h3><app-bars [points]="perDay()" label="Questions attempted per day" /></section>
        <section class="card stack"><h3>Study minutes per day</h3><app-bars [points]="minutesPerDay()" label="Study minutes per day" unit=" min" /></section>
      </div>
      <div class="grid two">
        <section class="card stack">
          <h3>By category (weakest first)</h3>
          <div class="table-wrap"><table class="table"><thead><tr><th>Category</th><th>Attempts</th><th>Avg score</th><th style="width:35%"></th></tr></thead><tbody>
            @for (c of a().byCategory; track c.categoryId) { <tr><td>{{ cats.name(c.categoryId) }}</td><td>{{ c.attempts }}</td><td>{{ c.avgScore }}%</td><td><app-bar [value]="c.avgScore" /></td></tr> }
          </tbody></table></div>
          <div class="small"><b>Strong areas:</b> {{ strong().join(', ') || '—' }} · <b>Weak areas:</b> {{ weakNames().join(', ') || '—' }}</div>
        </section>
        <section class="card stack">
          <h3>Revision status</h3>
          @for (s of statuses; track s) { @if (s !== 'New' && s !== 'Due' && s !== 'Overdue') { <div class="row between small"><app-status [status]="s" /><span>{{ a().statusCounts[s] || 0 }}</span></div> } }
          <h3 style="margin-top:8px">Interview performance</h3>
          @for (m of mocks(); track m.id) { <div class="row between small"><span>{{ m.title }} · {{ m.date }}</span><span class="badge">{{ m.overall }}</span></div> }
          @empty { <p class="small muted" style="margin:0">No completed mocks in this period.</p> }
        </section>
      </div>
    }
    <section class="card stack">
      <div class="row between"><h3 style="margin:0">Achievements</h3><span class="small muted">{{ progress.achievements.items().length }}/{{ all.length }}</span></div>
      <div class="grid three">
        @for (x of all; track x.id) {
          <div class="row small" [style.opacity]="earned().get(x.id) ? 1 : 0.45"><span>{{ earned().get(x.id) ? '🏅' : '○' }}</span><span class="grow">{{ x.title }}</span>
            @if (earned().get(x.id); as e) { <span class="xs muted">{{ e | date: 'd MMM' }}</span> }</div>
        }
      </div>
    </section>
    <section class="card stack">
      <h3>Backup & export</h3>
      <p class="small muted" style="margin:0">Your data is yours. Export everything as JSON, or the main tables as CSV.</p>
      <div class="row"><button class="btn" (click)="exp('json')">Export all (JSON)</button><button class="btn" (click)="exp('attempts')">Attempts (CSV)</button><button class="btn" (click)="exp('progress')">Revision status (CSV)</button><button class="btn" (click)="exp('jobs')">Jobs (CSV)</button><button class="btn" (click)="exp('notes')">Notes (CSV)</button></div>
    </section>
  </div>`,
})
export class ProgressComponent implements OnInit {
  progress = inject(ProgressService);
  cats = inject(CategoryService);
  private toast = inject(ToastService);
  ranges: { v: Range; label: string }[] = [{ v: '7', label: '7 days' }, { v: '30', label: '30 days' }, { v: '90', label: '90 days' }, { v: 'all', label: 'All time' }];
  statuses = SRS_STATUSES;
  all = ACHIEVEMENTS;
  range = signal<Range>('30');
  loading = signal(true);
  err = signal('');
  private tick = signal(0);
  a = computed(() => { this.tick(); return this.progress.analytics(this.range()); });
  readiness = computed(() => { this.tick(); return this.progress.readiness(); });
  perDay = computed(() => this.thin(this.a().byDay.map(d => ({ x: d.day.slice(5), v: d.attempts }))));
  minutesPerDay = computed(() => this.thin(this.a().byDay.map(d => ({ x: d.day.slice(5), v: d.minutes }))));
  avgConfidence = computed(() => { const l = this.progress.attempts.items().filter(x => x.date >= this.a().from); return l.length ? (l.reduce((n, x) => n + x.confidence, 0) / l.length).toFixed(1) : '—'; });
  revisionRate = computed(() => this.readiness().find(r => r.key === 'revision')?.value ?? 0);
  strong = computed(() => this.a().byCategory.filter(c => c.avgScore >= 75 && c.attempts >= 3).map(c => this.cats.name(c.categoryId)));
  weakNames = computed(() => this.a().byCategory.filter(c => c.avgScore < 60).map(c => this.cats.name(c.categoryId)));
  mocks = computed(() => this.progress.mocks.items().filter(m => m.status === 'completed' && m.date >= this.a().from).slice(0, 5));
  earned = computed(() => new Map(this.progress.achievements.items().map(x => [x.id, x.earnedAt])));

  ngOnInit() { this.load(); }
  async load() {
    this.loading.set(true);
    this.err.set('');
    try { await this.progress.loadAll(); await this.progress.checkAchievements(); this.tick.update(x => x + 1); }
    catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  /** Long ranges are summed into weekly buckets so bars stay readable on a phone. */
  private thin(p: { x: string; v: number }[]) {
    if (p.length <= 31) return p;
    const out: { x: string; v: number }[] = [];
    for (let i = 0; i < p.length; i += 7) out.push({ x: p[i].x, v: p.slice(i, i + 7).reduce((n, y) => n + y.v, 0) });
    return out;
  }
  async exp(k: 'json' | 'attempts' | 'progress' | 'jobs' | 'notes') {
    try { if (k === 'json') await this.progress.exportJson(); else await this.progress.exportCsv(k); this.toast.good('Export downloaded'); }
    catch (e) { this.toast.bad(errorMessage(e)); }
  }
}
