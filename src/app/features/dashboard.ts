import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ACHIEVEMENTS } from '../core/logic/achievements';
import { InterviewService } from '../core/services/career.service';
import { MasterDataStore } from '../core/services/master-data.service';
import { DailyPlanService } from '../core/services/plan.service';
import { ClockService } from '../core/services/platform.service';
import { ProgressService } from '../core/services/progress.service';
import { UserService } from '../core/services/user.service';
import { daysBetween, errorMessage } from '../core/util';
import { UI } from '../shared/ui';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Dashboard" [subtitle]="subtitle()"><a class="btn primary" routerLink="/app/today">Go to Today →</a></app-page-header>
    @if (loading()) { <app-loading [rows]="5" /> }
    @else if (err()) { <app-error [message]="err()" (retry)="load()" /> }
    @else {
      <section class="card hero stack">
        <div class="row between"><div><span class="eyebrow">Interview readiness</span><h2 style="margin:0">{{ overall() ?? '—' }}{{ overall() !== null ? '%' : '' }}</h2></div>
          @if (countdown(); as c) { <div class="badge warn" style="font-size:.9rem">{{ c }}</div> }</div>
        @if (overall() === null) { <p class="small muted" style="margin:0">Readiness appears after your first practice sessions. It is calculated only from your own attempts, sessions and mocks.</p> }
        <app-bar [value]="overall() ?? 0" />
        <div class="row"><a class="btn primary" routerLink="/app/today">{{ plan.progress().complete ? 'Plan complete ✓' : 'START TODAY' }}</a><span class="small muted">Today: {{ plan.progress().done }}/{{ plan.progress().total }} items</span></div>
      </section>
      <div class="grid stats">
        @for (r of areas(); track r.key) {
          <div class="card slim stack" style="gap:4px" [title]="r.note"><span class="eyebrow">{{ r.label }}</span><b style="font-size:1.3rem">{{ r.value === null ? '—' : r.value + '%' }}</b><app-bar [value]="r.value ?? 0" /></div>
        }
      </div>
      <div class="grid stats">
        <div class="card slim stat"><span class="eyebrow">Streak</span><b>{{ streak().current }}</b><span class="xs muted">best {{ streak().best }}</span></div>
        <div class="card slim stat"><span class="eyebrow">Questions practised</span><b>{{ a30().questions }}</b><span class="xs muted">last 30 days</span></div>
        <div class="card slim stat"><span class="eyebrow">Study minutes</span><b>{{ a30().minutes }}</b><span class="xs muted">last 30 days</span></div>
        <div class="card slim stat"><span class="eyebrow">Mastered</span><b>{{ mastered() }}</b><span class="xs muted">of {{ md.questions().length }} questions</span></div>
      </div>
      <div class="grid two">
        <section class="card stack">
          <h3>Quick actions</h3>
          <div class="grid two">
            <a class="btn" routerLink="/app/practice" [queryParams]="{ source: 'revision' }">↻ Quick revision</a>
            <a class="btn" routerLink="/app/voice">🎙 Voice interview</a>
            <a class="btn" routerLink="/app/mock-interview">🧑‍💼 Mock interview</a>
            <a class="btn" routerLink="/app/communication">💬 Speaking drill</a>
            <a class="btn" routerLink="/app/weak-areas">◎ Weak areas</a>
            <a class="btn" routerLink="/app/jobs">💼 Jobs</a>
          </div>
        </section>
        <section class="card stack">
          <div class="row between"><h3 style="margin:0">Achievements</h3><span class="small muted">{{ progress.achievements.items().length }}/{{ total }}</span></div>
          @for (a of progress.achievements.items().slice(0, 6); track a.id) { <div class="row small"><span>🏅</span><span class="grow">{{ a.title }}</span><span class="xs muted">{{ a.earnedAt | date: 'd MMM' }}</span></div> }
          @empty { <p class="small muted" style="margin:0">Earned from real activity: your first practised question unlocks the first one.</p> }
        </section>
      </div>
    }
  </div>`,
})
export class DashboardComponent implements OnInit {
  progress = inject(ProgressService);
  plan = inject(DailyPlanService);
  md = inject(MasterDataStore);
  private user = inject(UserService);
  private interviews = inject(InterviewService);
  private clock = inject(ClockService);
  loading = signal(true);
  err = signal('');
  total = ACHIEVEMENTS.length;
  private tick = signal(0);
  readiness = computed(() => { this.tick(); return this.progress.readiness(); });
  overall = computed(() => this.readiness()[0].value);
  areas = computed(() => this.readiness().slice(1));
  a30 = computed(() => { this.tick(); return this.progress.analytics('30'); });
  streak = computed(() => { this.tick(); return this.progress.streak(); });
  mastered = computed(() => this.progress.revision.items().filter(s => s.status === 'Mastered').length);
  subtitle = computed(() => { const p = this.user.profile(); return p ? `${p.targetRole || 'Senior Full-Stack Developer'}${p.targetSalary ? ' · target ' + p.targetSalary : ''}` : ''; });
  countdown = computed(() => {
    const d = this.plan.nextInterviewDate();
    if (!d) return null;
    const n = daysBetween(this.clock.today(), d);
    return n === 0 ? 'Interview today' : `Interview in ${n} day${n === 1 ? '' : 's'}`;
  });

  ngOnInit() { this.load(); }
  async load() {
    this.loading.set(true);
    this.err.set('');
    try {
      await Promise.all([this.progress.loadAll(), this.plan.ensureToday(), this.interviews.ensureLoaded()]);
      this.tick.update(x => x + 1);
    } catch (e) { this.err.set(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
}
