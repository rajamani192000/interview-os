import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ratingFromScore } from '../core/logic/srs';
import { InterviewTurn, MockInterview } from '../core/models';
import { AIInterviewService } from '../core/services/ai.service';
import { JobService, ProjectService } from '../core/services/career.service';
import { MasterDataStore } from '../core/services/master-data.service';
import { DailyPlanService, StudySessionService } from '../core/services/plan.service';
import { ToastService } from '../core/services/platform.service';
import { AttemptService, BookmarkService, RevisionService } from '../core/services/practice.service';
import { MockInterviewService } from '../core/services/speaking.service';
import { UserService } from '../core/services/user.service';
import { ListenSession, VoiceService } from '../core/services/voice.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

/** Multi-round mock interview. Progress is saved after every answer so a mock can be resumed. */
@Component({
  selector: 'app-mock',
  imports: [FormsModule, RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    <app-page-header title="Mock Interview" subtitle="Technical, project, design and behavioral rounds from your own data" />
    @if (loading()) { <app-loading /> }
    @else if (!active()) {
      @if (!md.questions().length) { <app-empty title="No questions yet" text="Mocks are built from your question bank. Import questions first." /> }
      @else {
        <section class="card stack">
          <div class="field"><label for="job">Tailor to a job (optional)</label>
            <select id="job" class="input" [(ngModel)]="jobId"><option value="">General senior full-stack mock</option>
              @for (j of jobs.active(); track j.id) { <option [value]="j.id">{{ j.company }} — {{ j.title }}</option> }</select>
            <span class="hint">With a job, technical questions are weighted to the JD's skills that you haven't covered yet.</span></div>
          <label class="check small"><input type="checkbox" [(ngModel)]="readAloud" /> Read questions aloud</label>
          @if (!projects.items().length) { <p class="xs muted" style="margin:0">Tip: add your projects (Projects page) to get a project deep-dive round.</p> }
          <button class="btn primary big block" (click)="create()" [disabled]="busy()">Start mock interview</button>
        </section>
        @if (inProgress(); as ip) { <div class="banner info small row between"><span>You have an unfinished mock from {{ ip.date }}.</span><button class="btn sm" (click)="resume(ip)">Resume</button></div> }
        <section class="card stack">
          <h3>History</h3>
          @for (m of completed(); track m.id) {
            <details class="card slim"><summary style="cursor:pointer" class="row between"><span class="small">{{ m.title }} · {{ m.date }}</span><span class="badge {{ (m.overall || 0) >= 70 ? 'good' : (m.overall || 0) >= 45 ? 'warn' : 'bad' }}">{{ m.overall }}</span></summary>
              @for (s of m.strengths || []; track $index) { <div class="small">✓ {{ s }}</div> }
              @for (s of m.improvements || []; track $index) { <div class="small">→ {{ s }}</div> }
            </details>
          } @empty { <p class="small muted" style="margin:0">No completed mocks yet.</p> }
        </section>
      }
    } @else if (active(); as m) {
      @if (m.status === 'completed') {
        <section class="card stack">
          <h2>Result: {{ m.overall }}/100</h2>
          <p class="small muted" style="margin:0">{{ m.turns.length }} answers · {{ Math.round(m.durationSec / 60) }} min</p>
          @for (s of m.strengths || []; track $index) { <div class="small">✓ {{ s }}</div> }
          @for (s of m.improvements || []; track $index) { <div class="small">→ {{ s }}</div> }
          @for (t of m.turns; track $index) { <div class="card slim small"><b>{{ t.question }}</b><div class="muted">Score {{ t.score }} · {{ t.feedback.slice(0, 2).join(' ') }}</div></div> }
          <button class="btn primary block" (click)="active.set(null)">Done</button>
          <a class="btn block" routerLink="/app/weak-areas">See weak areas</a>
        </section>
      } @else if (currentPrompt(); as p) {
        <div class="row between small muted"><span>{{ roundName() }} · {{ answered() + 1 }} of {{ total() }}</span><button class="btn ghost sm" (click)="finish()">Finish now</button></div>
        <app-bar [value]="(answered() / total()) * 100" />
        <section class="card stack">
          <h2>{{ p.question }}</h2>
          @if (evaluating()) { <div class="row"><div class="spinner"></div>Evaluating…</div> }
          @else if (last(); as t) {
            <div class="banner {{ t.score >= 70 ? 'good' : t.score >= 45 ? 'warn' : 'bad' }} small"><b>{{ t.score }}/100</b> @for (f of t.feedback.slice(0, 3); track $index) { <div>• {{ f }}</div> }</div>
            <button class="btn primary big block" (click)="next()">Next →</button>
          } @else {
            @if (listen(); as l) {
              <div class="card slim small" style="min-height:90px;background:var(--surface-2)"><span class="mic-dot" style="display:inline-block"></span> {{ l.text() }} <span class="muted">{{ l.interim() }}</span></div>
              @if (l.error()) { <div class="banner warn small">{{ l.error() }}</div> }
              <button class="btn primary big block" (click)="submit()">Done answering</button>
            } @else {
              <textarea class="input" rows="6" [(ngModel)]="typed" placeholder="Your answer"></textarea>
              <div class="grid two">@if (voice.sttSupported) { <button class="btn big" (click)="listen.set(voice.listen())">🎙 Speak</button> }
                <button class="btn primary big" (click)="submit()" [disabled]="!typed.trim()">Submit</button></div>
            }
          }
        </section>
      }
    }
  </div>`,
})
export class MockComponent implements OnInit, OnDestroy {
  md = inject(MasterDataStore);
  jobs = inject(JobService);
  projects = inject(ProjectService);
  voice = inject(VoiceService);
  private svc = inject(MockInterviewService);
  private ai = inject(AIInterviewService);
  private attempts = inject(AttemptService);
  private revision = inject(RevisionService);
  private bookmarks = inject(BookmarkService);
  private plan = inject(DailyPlanService);
  private study = inject(StudySessionService);
  private user = inject(UserService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  Math = Math;
  loading = signal(true);
  busy = signal(false);
  evaluating = signal(false);
  active = signal<(MockInterview & { id?: string }) | null>(null);
  listen = signal<ListenSession | null>(null);
  last = signal<InterviewTurn | null>(null);
  jobId = '';
  typed = '';
  readAloud = true;
  private started = Date.now();
  private qStart = Date.now();

  flat = computed(() => (this.active()?.rounds || []).flatMap(r => r.questionIds.map(id => ({ round: r.name, id }))));
  total = computed(() => this.flat().length || 1);
  answered = computed(() => this.active()?.turns.length ?? 0);
  current = computed(() => this.flat()[this.answered() - (this.last() ? 1 : 0)] ?? null);
  roundName = computed(() => this.current()?.round ?? '');
  currentPrompt = computed(() => { const c = this.current(); return c ? this.svc.promptFor(c.id, this.projects.items()) : null; });
  completed = computed(() => this.svc.items().filter(m => m.status === 'completed'));
  inProgress = computed(() => this.svc.items().find(m => m.status === 'in-progress') ?? null);

  async ngOnInit() {
    this.jobId = this.route.snapshot.queryParamMap.get('job') || '';
    try { await Promise.all([this.md.ensureLoaded(), this.svc.ensureLoaded(), this.jobs.ensureLoaded(), this.projects.ensureLoaded(), this.revision.ensureLoaded(), this.attempts.ensureLoaded(), this.bookmarks.ensureLoaded()]); }
    catch (e) { this.toast.bad(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  ngOnDestroy() { this.listen()?.stop(); this.voice.stopSpeaking(); }

  async create() {
    const job = this.jobId ? this.jobs.byId(this.jobId) : undefined;
    const m = this.svc.build(job, this.projects.items());
    if (!m.rounds.length) { this.toast.bad('Not enough questions for a mock yet.'); return; }
    this.busy.set(true);
    try {
      const saved = await this.svc.save(m);
      this.open(saved);
    } catch (e) { this.toast.bad(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  resume(m: MockInterview & { id: string }) { this.open(m); }
  private open(m: MockInterview & { id?: string }) {
    this.active.set(m);
    this.last.set(null);
    this.started = Date.now() - (m.durationSec || 0) * 1000;
    this.study.begin('practice');
    this.ask();
  }
  private ask() {
    this.typed = '';
    this.qStart = Date.now();
    const p = this.currentPrompt();
    if (p && this.readAloud) this.voice.speak(p.question);
  }
  async submit() {
    const m = this.active(), p = this.currentPrompt(), c = this.current();
    if (!m || !p || !c) return;
    let text = this.typed.trim(), dur = Math.round((Date.now() - this.qStart) / 1000), spoken = false;
    const l = this.listen();
    if (l) { const r = await l.stop(); this.listen.set(null); text = (text + ' ' + r.text).trim(); dur = r.durationSec; spoken = true; }
    this.evaluating.set(true);
    const prof = this.user.profile();
    const ev = await this.ai.evaluate({ question: p.question, answer: p.q?.answer || p.reference || '', keyPoints: p.q?.keyPoints || [] }, text, spoken ? dur : 0, { role: prof?.targetRole, years: prof?.yearsExperience, mode: 'mock' });
    const turn: InterviewTurn = { questionId: p.q?.id, question: p.question, answer: text, score: ev.score, feedback: ev.feedback, missed: ev.missed, durationSec: dur };
    const next = { ...m, turns: [...m.turns, turn], durationSec: Math.round((Date.now() - this.started) / 1000) };
    this.active.set(next);
    this.last.set(turn);
    this.evaluating.set(false);
    try {
      await this.svc.save(next, m.id);
      if (p.q) await this.attempts.record(p.q, { mode: 'mock', rating: ratingFromScore(ev.score), score: ev.score, confidence: 3, durationSec: dur, answerText: text });
    } catch (e) { this.toast.bad('Progress not saved: ' + errorMessage(e)); }
  }
  next() {
    this.last.set(null);
    if (this.answered() >= this.total()) { this.finish(); return; }
    this.ask();
  }
  async finish() {
    const m = this.active();
    if (!m) return;
    this.listen()?.stop();
    this.listen.set(null);
    this.voice.stopSpeaking();
    const done: MockInterview & { id?: string } = { ...m, status: 'completed', durationSec: Math.round((Date.now() - this.started) / 1000), ...this.svc.summarize(m) };
    try {
      await this.svc.save(done, m.id);
      this.active.set(done);
      this.last.set(null);
      await this.study.end();
      await this.plan.ensureToday();
      await this.plan.completeMatching('mock');
    } catch (e) { this.toast.bad(errorMessage(e)); }
  }
}
