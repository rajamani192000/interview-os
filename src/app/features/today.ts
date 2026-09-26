import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PlanItem } from '../core/models';
import { AuthService } from '../core/services/auth.service';
import { InterviewService, JobService } from '../core/services/career.service';
import { CategoryService, MasterDataStore } from '../core/services/master-data.service';
import { DailyPlanService, StudySessionService } from '../core/services/plan.service';
import { ClockService, ToastService } from '../core/services/platform.service';
import { AttemptService, BookmarkService, RevisionService } from '../core/services/practice.service';
import { ProgressService } from '../core/services/progress.service';
import { SettingsService, UserService } from '../core/services/user.service';
import { daysBetween, errorMessage } from '../core/util';
import { UI } from '../shared/ui';
import { AllowanceComponent } from '../shared/schedule-ui';
import { ScheduleService } from '../core/services/schedule.service';

const TYPE_LABEL: Record<PlanItem['type'], string> = { revision: 'Revision', weak: 'Weak area', new: 'New', communication: 'Communication', voice: 'Voice interview', mock: 'Mock', 'job-prep': 'Job prep' };

/** TODAY: the first screen after sign-in. One primary action: START TODAY. */
@Component({
  selector: 'app-today',
  imports: [RouterLink, AllowanceComponent, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    @if (loading()) { <app-loading text="Building today's plan…" [rows]="4" /> }
    @else if (plan.state() === 'error' || err()) { <app-error title="Couldn't load today's plan" [message]="err() || plan.error()" (retry)="load()" /> }
    @else if (!md.questions().length) {
      <app-empty title="No questions yet" text="Your plan is built from your own question bank, which is empty right now. Import your questions first.">
        @if (auth.isAdmin()) { <a class="btn primary" routerLink="/admin/questions" [queryParams]="{ import: 1 }">Import questions</a> }
        @else { <span class="small muted">Ask the administrator to import questions, or set yourself as admin (see SETUP.md).</span> }
      </app-empty>
    } @else if (plan.plan(); as p) {
      <div>
        <span class="eyebrow">{{ dateLabel }}</span>
        <h1 style="margin:2px 0">{{ greeting() }}</h1>
      </div>

      @if (p.mode === 'recovery' && !pr().done) {
        <section class="card hero stack">
          <h2>WELCOME BACK</h2>
          <p style="margin:0">Your goal is still active. Let's restart with 15 minutes.</p>
          <p class="small muted" style="margin:0">{{ missed() }} planned day{{ missed() === 1 ? '' : 's' }} missed — no backlog. Today: 3 revision · 2 weak · 1 communication · 1 voice. Normal plans resume after this.</p>
          <button class="btn primary big block" (click)="start()" [disabled]="schedule.access()?.allowed === false">START RECOVERY</button>
        </section>
      } @else if (interviewDays() === 0) {
        <section class="card hero stack">
          <h2>Interview today{{ nextInterview()?.company ? ' — ' + nextInterview()?.company : '' }}</h2>
          <p class="small" style="margin:0">Quick warm-up: 5 familiar questions, your self introduction, then rest.</p>
          <div class="grid two"><a class="btn primary big" routerLink="/app/practice" [queryParams]="{ source: 'warmup' }">Start warm-up</a>
          <a class="btn big" routerLink="/app/communication" [queryParams]="{ type: 'Self introduction' }">Rehearse introduction</a></div>
        </section>
      }

      <app-allowance />
      <section class="card stack">
        <div class="row between"><h2 style="margin:0">Today's preparation</h2><span class="badge {{ p.mode === 'normal' ? '' : 'warn' }}">{{ p.mode === 'normal' ? 'Normal plan' : p.mode === 'recovery' ? 'Recovery plan' : 'Interview plan' }}</span></div>
        <p class="xs muted" style="margin:0">{{ why() }}</p>
        <app-bar [value]="pr().pct" />
        <div class="grid stats">
          <div class="stat"><span class="eyebrow">Progress</span><b>{{ pr().done }}/{{ pr().total }}</b></div>
          <div class="stat"><span class="eyebrow">Time remaining</span><b>{{ remaining() }} min</b></div>
          <div class="stat"><span class="eyebrow">Streak</span><b>{{ streak().current }} day{{ streak().current === 1 ? '' : 's' }}</b></div>
          <div class="stat"><span class="eyebrow">Minimum</span><b>{{ minutesToday() }}/{{ settings.settings().minMinutes }} min</b><span class="xs {{ minutesToday() >= settings.settings().minMinutes ? 'muted' : 'muted' }}">{{ minutesToday() >= settings.settings().minMinutes ? 'Minimum met ✓' : 'Minimum commitment' }}</span></div>
        </div>
        @if (pr().complete) {
          <div class="banner good">Today's plan is complete. Your next revisions are scheduled — see you tomorrow.</div>
          <div class="row"><a class="btn primary" routerLink="/app/progress">See progress</a><a class="btn" routerLink="/app/practice" [queryParams]="{ source: 'new' }">Practise extra</a></div>
        } @else if (p.mode !== 'recovery' || pr().done) {
          <button class="btn primary big block" (click)="start()" [disabled]="schedule.access()?.allowed === false">{{ pr().done ? 'CONTINUE' : 'START TODAY' }} <span class="small" style="font-weight:500">· next: {{ typeLabel[pr().next!.type] }}</span></button>
        }
      </section>

      @if (focusWarn(); as f) {
        <section class="card stack" style="border-color:var(--warn)">
          <b>You completed {{ f.completed }} of your last {{ f.planned }} planned sessions.</b>
          <p class="small muted" style="margin:0">Would a smaller or better-timed plan help?</p>
          <div class="row">
            <button class="btn sm" (click)="reduceTarget()" [disabled]="settings.settings().dailyMinutes <= 20">Reduce daily target to {{ reducedTarget() }} min</button>
            <a class="btn sm" routerLink="/app/settings" [queryParams]="{ tab: 'routine' }">Change preparation time</a>
            <button class="btn sm primary" (click)="recovery()">Start 15-minute recovery</button>
          </div>
        </section>
      }

      <div class="grid two">
        <section class="card stack">
          <h3>Today's focus</h3>
          @for (g of focus(); track g.label) { <div class="row between small"><span>{{ g.label }}</span><span class="muted">{{ g.minutes }} min</span></div> }
          <div class="list">
            @for (i of p.items; track i.id) {
              <div class="list-item clickable" (click)="open(i)" (keydown.enter)="open(i)" tabindex="0" role="button">
                <span aria-hidden="true">{{ i.done ? '✅' : '⬜' }}</span>
                <span class="grow small" [style.text-decoration]="i.done ? 'line-through' : ''">{{ i.title }}</span>
                <span class="badge">{{ typeLabel[i.type] }}</span>
              </div>
            }
          </div>
          <button class="btn ghost sm" (click)="regenerate()" [disabled]="busy()">↻ Rebuild plan (keeps completed items)</button>
        </section>
        <div class="stack">
          <section class="card stack">
            <div class="row between"><h3 style="margin:0">Due revisions</h3><span class="badge {{ due() ? 'Due' : 'good' }}">{{ due() }}</span></div>
            @if (due()) { <a class="btn sm" routerLink="/app/practice" [queryParams]="{ source: 'revision' }">Quick revision ({{ due() }})</a> }
            @else { <p class="small muted" style="margin:0">No revision due today.</p> }
          </section>
          <section class="card stack">
            <h3 style="margin:0">Weak topics</h3>
            @for (w of weak(); track w.key) { <div class="row between small"><span>{{ w.name }} <span class="muted xs">{{ w.categoryName }}</span></span><span class="badge bad">{{ w.avgScore }}%</span></div> }
            @empty { <p class="small muted" style="margin:0">No weak topics yet — they appear after you practise.</p> }
            @if (weak().length) { <a class="btn sm" routerLink="/app/weak-areas">Open weak areas</a> }
          </section>
          <section class="card stack">
            <h3 style="margin:0">Upcoming interviews</h3>
            @for (i of interviews.upcoming().slice(0, 3); track i.id) {
              <div class="row between small"><span>{{ i.company }} · {{ i.round }}</span><span class="badge {{ interviews.daysTo(i) <= 2 ? 'warn' : '' }}">{{ countdown(i.date) }}</span></div>
            } @empty {
              @if (user.goal().interviewDate && interviewDays()! >= 0) { <div class="small">Interview goal date: <b>{{ countdown(user.goal().interviewDate!) }}</b></div> }
              @else { <p class="small muted" style="margin:0">No upcoming interview. Add one from Jobs.</p> }
            }
            <a class="btn sm" routerLink="/app/jobs">Jobs & interviews</a>
          </section>
        </div>
      </div>
    }
  </div>`,
})
export class TodayComponent implements OnInit {
  auth = inject(AuthService);
  plan = inject(DailyPlanService);
  md = inject(MasterDataStore);
  settings = inject(SettingsService);
  user = inject(UserService);
  interviews = inject(InterviewService);
  private jobs = inject(JobService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private bookmarks = inject(BookmarkService);
  private sessions = inject(StudySessionService);
  private progress = inject(ProgressService);
  private cats = inject(CategoryService);
  private clock = inject(ClockService);
  private toast = inject(ToastService);
  private router = inject(Router);
  schedule = inject(ScheduleService);
  typeLabel = TYPE_LABEL;
  loading = signal(true);
  busy = signal(false);
  err = signal('');
  dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  pr = this.plan.progress;
  remaining = computed(() => { const p = this.plan.plan(); return p ? p.items.filter(i => !i.done).reduce((n, i) => n + i.minutes, 0) : 0; });
  streak = computed(() => { this.attempts.items(); this.sessions.items(); this.plan.plan(); return this.progress.streak(); });
  minutesToday = computed(() => { const s = this.sessions.minutesToday(); return Math.max(s, this.pr().minutesDone); });
  due = computed(() => this.revision.due().length);
  weak = computed(() => { this.attempts.items(); return this.progress.weak('topic').slice(0, 3); });
  missed = computed(() => { this.attempts.items(); return this.plan.missedDays(); });
  nextInterview = computed(() => this.interviews.next());
  interviewDays = computed(() => { const d = this.plan.nextInterviewDate(); return d ? daysBetween(this.clock.today(), d) : null; });
  focusWarn = computed(() => {
    this.attempts.items(); this.sessions.items(); this.plan.history();
    const c = this.plan.consistency(7);
    return c.planned >= 3 && c.completed / c.planned < 0.6 && this.plan.plan()?.mode !== 'recovery' ? c : null;
  });
  reducedTarget = computed(() => Math.max(20, this.settings.settings().dailyMinutes - 15));
  greeting = computed(() => {
    const n = (this.user.profile()?.displayName || '').split(' ')[0];
    const h = new Date().getHours();
    return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${n ? ', ' + n : ''}`;
  });
  /** Explains how today's plan was built, from the stored plan and current data. */
  why = computed(() => {
    const p = this.plan.plan();
    if (!p) return '';
    const n = (t: string) => p.items.filter(i => i.type === t).length;
    const parts = [n('revision') && `${n('revision')} due revision${n('revision') > 1 ? 's' : ''}`, n('weak') && `${n('weak')} weak`, n('new') && `${n('new')} new`, n('job-prep') && 'job prep'].filter(Boolean);
    const lead = p.mode === 'recovery' ? `Recovery: ${this.missed()} planned day(s) missed, so a short restart instead of a backlog.` : p.mode === 'interview' ? `Interview in ${this.interviewDays()} day(s): revision and weak areas first, no new questions.` : `Built for your ${this.settings.settings().dailyMinutes}-minute target.`;
    return `${lead} ${parts.join(' · ')}${parts.length ? ' · ' : ''}speaking drill${p.items.some(i => i.type === 'voice') ? ' · voice question' : ''}.`;
  });
  focus = computed(() => {
    const p = this.plan.plan();
    if (!p) return [];
    const g = new Map<string, number>();
    for (const i of p.items) {
      const q = i.refId ? this.md.questionMap().get(i.refId) : undefined;
      const label = q ? `${this.cats.name(q.categoryId)} ${i.type === 'new' ? 'Practice' : i.type === 'weak' ? 'Weak areas' : 'Revision'}` : TYPE_LABEL[i.type];
      g.set(label, (g.get(label) || 0) + i.minutes);
    }
    return [...g].map(([label, minutes]) => ({ label, minutes }));
  });

  ngOnInit() { this.load(); }

  async load() {
    this.loading.set(true);
    this.err.set('');
    try {
      await this.md.ensureLoaded();
      this.schedule.ensureLoaded().catch(() => undefined);
      await Promise.all([this.plan.ensureToday(), this.revision.ensureLoaded(), this.attempts.ensureLoaded(), this.sessions.ensureLoaded(), this.interviews.ensureLoaded(), this.bookmarks.ensureLoaded()]);
      this.plan.loadHistory(14).catch(() => undefined);
      this.jobs.ensureLoaded().catch(() => undefined);
    } catch (e) {
      this.err.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  countdown(date: string) {
    const d = daysBetween(this.clock.today(), date);
    return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `in ${d} days`;
  }

  async start() {
    await this.plan.start().catch(() => undefined);
    const n = this.pr().next;
    if (n) this.open(n);
  }

  open(i: PlanItem) {
    switch (i.type) {
      case 'communication': this.router.navigate(['/app/communication'], { queryParams: { plan: 1 } }); break;
      case 'voice': this.router.navigate(['/app/voice'], { queryParams: { plan: 1, mode: this.plan.plan()?.mode === 'recovery' ? 'quick' : 'quick' } }); break;
      case 'mock': this.router.navigate(['/app/mock-interview']); break;
      case 'job-prep': this.router.navigate(['/app/jobs', i.refId], { queryParams: { plan: 1 } }); break;
      default:
        if (i.done && i.refId) this.router.navigate(['/app/practice'], { queryParams: { q: i.refId } });
        else this.router.navigate(['/app/practice'], { queryParams: { source: 'plan' } });
    }
  }

  async regenerate() {
    this.busy.set(true);
    try { await this.plan.regenerate(); this.toast.good('Plan rebuilt'); } catch (e) { this.toast.bad(errorMessage(e)); } finally { this.busy.set(false); }
  }
  async reduceTarget() {
    try {
      await this.settings.save({ dailyMinutes: this.reducedTarget(), minMinutes: Math.min(this.settings.settings().minMinutes, this.reducedTarget()) });
      await this.plan.regenerate();
      this.toast.good(`Daily target is now ${this.settings.settings().dailyMinutes} minutes`);
    } catch (e) { this.toast.bad(errorMessage(e)); }
  }
  async recovery() {
    try { await this.plan.regenerate(true); this.toast.good('Recovery plan ready: about 15 minutes'); } catch (e) { this.toast.bad(errorMessage(e)); }
  }
}
