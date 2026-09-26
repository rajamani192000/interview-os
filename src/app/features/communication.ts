import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { speechMetrics } from '../core/logic/scoring';
import { COMM_DIMENSIONS, COMM_TYPES, CommDimension, CommType, CommunicationSession, Question, SpeechMetrics } from '../core/models';
import { AIInterviewService } from '../core/services/ai.service';
import { MasterDataStore } from '../core/services/master-data.service';
import { DailyPlanService, StudySessionService } from '../core/services/plan.service';
import { ClockService, ToastService } from '../core/services/platform.service';
import { RevisionService } from '../core/services/practice.service';
import { COMM_PROMPTS, CommunicationService } from '../core/services/speaking.service';
import { UserService } from '../core/services/user.service';
import { ListenSession, VoiceService } from '../core/services/voice.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

type Kind = CommType | 'Technical answer';
const DIM_LABEL: Record<CommDimension, string> = { clarity: 'Clarity', confidence: 'Confidence', accuracy: 'Technical accuracy', structure: 'Structure', conciseness: 'Conciseness', grammar: 'Grammar' };

@Component({
  selector: 'app-communication',
  imports: [FormsModule, RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    <app-page-header title="Communication Practice" subtitle="Say it out loud, then rate clarity, structure and confidence" />
    @switch (stage()) {
      @case ('pick') {
        <section class="card stack">
          <span class="label">Choose an exercise</span>
          <div class="row">
            <button class="chip" [class.on]="kind() === 'Technical answer'" (click)="setKind('Technical answer')">Technical answer (from your bank)</button>
            @for (t of types; track t) { <button class="chip" [class.on]="kind() === t" (click)="setKind(t)">{{ t }}</button> }
          </div>
          <div class="card slim" style="background:var(--surface-2)"><b>{{ prompt() }}</b>
            @if (kind() === 'Technical answer' && !question()) { <p class="small muted" style="margin:4px 0 0">Your bank is empty — pick another exercise.</p> }</div>
          <div class="row"><button class="btn sm ghost" (click)="shuffle()">↻ Another prompt</button>
            <label class="small row">Time limit <select class="input" style="width:auto;min-height:34px" [(ngModel)]="limit"><option [ngValue]="60">1 min</option><option [ngValue]="120">2 min</option><option [ngValue]="180">3 min</option></select></label></div>
          <div class="grid two">
            <button class="btn primary big" (click)="begin(true)" [disabled]="!prompt() || !voice.sttSupported">🎙 Speak</button>
            <button class="btn big" (click)="begin(false)" [disabled]="!prompt()">⌨ Type</button>
          </div>
          @if (!voice.sttSupported) { <p class="xs muted" style="margin:0">Speech recognition isn't available in this browser (Chrome and Edge support it). Typing still tracks structure and filler words.</p> }
        </section>
        <section class="card stack">
          <h3>Recent sessions</h3>
          @if (comm.state() === 'loading') { <div class="skeleton"></div> }
          @for (s of comm.recent(6); track s.id) {
            <div class="row between small"><span class="grow">{{ s.type }} · {{ s.date }}</span><span class="muted">{{ s.metrics.wpm || '–' }} wpm · {{ s.metrics.fillers }} fillers · {{ s.selfRating }}/5</span></div>
          } @empty { <p class="small muted" style="margin:0">No sessions yet.</p> }
        </section>
      }
      @case ('run') {
        <section class="card stack">
          <div class="row between"><span class="badge">{{ kind() }}</span><b [style.color]="left() <= 10 ? 'var(--bad)' : ''">⏱ {{ leftLabel() }}</b></div>
          <h2>{{ prompt() }}</h2>
          @if (listen(); as l) {
            <div class="row small"><span class="mic-dot"></span><span class="muted">Listening…</span></div>
            <div class="card slim small" style="min-height:80px;background:var(--surface-2)">{{ l.text() }} <span class="muted">{{ l.interim() }}</span></div>
            @if (l.error()) { <div class="banner warn small">{{ l.error() }}</div> }
          } @else {
            <textarea class="input" rows="8" [(ngModel)]="text" placeholder="Write it the way you would say it"></textarea>
          }
          <button class="btn primary big block" (click)="stop()">Done</button>
        </section>
      }
      @case ('review') {
        <section class="card stack">
          <h3>Your answer</h3>
          <div class="pre small">{{ text || '(nothing captured)' }}</div>
          <div class="grid stats">
            <div class="stat"><span class="eyebrow">Words</span><b>{{ metrics()?.words }}</b></div>
            <div class="stat"><span class="eyebrow">Pace</span><b>{{ metrics()?.wpm || '–' }}</b><span class="xs muted">words/min</span></div>
            <div class="stat"><span class="eyebrow">Filler words</span><b>{{ metrics()?.fillers }}</b><span class="xs muted">{{ fillerList() }}</span></div>
            <div class="stat"><span class="eyebrow">Time</span><b>{{ duration() }}s</b></div>
          </div>
          @if (aiBusy()) { <div class="row small"><div class="spinner"></div>Getting feedback…</div> }
          @for (f of feedback(); track $index) { <div class="small">• {{ f }}</div> }
          @if (question(); as q) { <details><summary class="label" style="cursor:pointer">Reference answer</summary><div class="answer small">{{ q.answer }}</div></details> }
          <span class="label">Rate yourself (1–5)</span>
          @for (d of dims; track d) {
            <div class="row between"><span class="small">{{ dimLabel[d] }}</span><span class="row">@for (n of [1, 2, 3, 4, 5]; track n) { <button class="chip" [class.on]="ratings()[d] === n" (click)="rate(d, n)">{{ n }}</button> }</span></div>
          }
          @if (error()) { <div class="banner bad small">{{ error() }}</div> }
          <div class="grid two">
            <button class="btn" (click)="retry()">↻ Retry</button>
            <button class="btn primary" (click)="save()" [disabled]="saving() || !rated()">{{ saving() ? 'Saving…' : 'Save session' }}</button>
          </div>
        </section>
      }
      @case ('saved') {
        <div class="card stack center"><h2>Saved ✓</h2><p class="muted small">Average self rating {{ avgRating() }}/5.</p>
          @if (fromPlan && plan.progress().next; as n) {
            <a class="btn primary big block" [routerLink]="n.type === 'voice' ? '/app/voice' : n.type === 'communication' ? '/app/communication' : '/app/practice'" [queryParams]="n.type === 'voice' ? { plan: 1, mode: 'quick' } : { source: 'plan' }" (click)="n.type === 'communication' && reset()">Next: {{ n.title }} →</a>
          } @else if (fromPlan) { <a class="btn primary big block" routerLink="/app/today">Back to Today</a> }
          <button class="btn block" (click)="reset()">Another exercise</button></div>
      }
    }
  </div>`,
})
export class CommunicationComponent implements OnInit, OnDestroy {
  comm = inject(CommunicationService);
  voice = inject(VoiceService);
  plan = inject(DailyPlanService);
  private md = inject(MasterDataStore);
  private revision = inject(RevisionService);
  private ai = inject(AIInterviewService);
  private user = inject(UserService);
  private sessions = inject(StudySessionService);
  private clock = inject(ClockService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  types = COMM_TYPES;
  dims = COMM_DIMENSIONS;
  dimLabel = DIM_LABEL;
  stage = signal<'pick' | 'run' | 'review' | 'saved'>('pick');
  kind = signal<Kind>('Self introduction');
  prompt = signal('');
  question = signal<Question | null>(null);
  listen = signal<ListenSession | null>(null);
  metrics = signal<SpeechMetrics | null>(null);
  duration = signal(0);
  feedback = signal<string[]>([]);
  aiBusy = signal(false);
  ratings = signal<Partial<Record<CommDimension, number>>>({});
  saving = signal(false);
  error = signal('');
  now = signal(Date.now());
  limit = 120;
  text = '';
  fromPlan = false;
  private started = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  left = computed(() => Math.max(0, this.limit - Math.floor((this.now() - this.started) / 1000)));
  leftLabel = computed(() => `${Math.floor(this.left() / 60)}:${String(this.left() % 60).padStart(2, '0')}`);
  rated = computed(() => Object.keys(this.ratings()).length >= 3);
  avgRating = computed(() => { const v = Object.values(this.ratings()) as number[]; return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : 0; });
  fillerList = computed(() => Object.entries(this.metrics()?.fillerWords || {}).map(([k, v]) => `${k}×${v}`).join(', '));

  async ngOnInit() {
    this.fromPlan = !!this.route.snapshot.queryParamMap.get('plan');
    const t = this.route.snapshot.queryParamMap.get('type') as Kind | null;
    await Promise.all([this.md.ensureLoaded().catch(() => undefined), this.revision.ensureLoaded().catch(() => undefined), this.comm.ensureLoaded().catch(e => this.toast.bad(errorMessage(e)))]);
    this.setKind(t && (COMM_TYPES as string[]).concat('Technical answer').includes(t) ? t : this.fromPlan ? 'Technical answer' : 'Self introduction');
  }
  ngOnDestroy() {
    this.listen()?.stop();
    if (this.timer) clearInterval(this.timer);
  }

  setKind(k: Kind) {
    this.kind.set(k);
    this.shuffle();
  }
  shuffle() {
    const k = this.kind();
    if (k === 'Technical answer') {
      const learned = this.revision.items().map(s => this.md.questionMap().get(s.questionId)).filter((q): q is Question => !!q && !q.isArchived);
      const pool = learned.length ? learned : this.md.questions();
      const q = pool[Math.floor(Math.random() * pool.length)] || null;
      this.question.set(q);
      this.prompt.set(q ? `Explain out loud: ${q.question}` : '');
    } else {
      this.question.set(null);
      const l = COMM_PROMPTS[k];
      this.prompt.set(l[Math.floor(Math.random() * l.length)]);
    }
  }
  begin(speak: boolean) {
    this.text = '';
    this.started = Date.now();
    this.now.set(Date.now());
    this.stage.set('run');
    this.sessions.begin('practice');
    if (speak) this.listen.set(this.voice.listen());
    this.timer = setInterval(() => {
      this.now.set(Date.now());
      if (this.left() === 0) this.stop();
    }, 500);
  }
  async stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const l = this.listen();
    let dur = Math.round((Date.now() - this.started) / 1000);
    if (l) { const r = await l.stop(); this.text = r.text; dur = r.durationSec; this.listen.set(null); }
    this.duration.set(dur);
    const m = speechMetrics(this.text, l ? dur : 0);
    this.metrics.set(m);
    const tips: string[] = [];
    if (m.words < 40) tips.push('Short answer. Aim for 60–120 seconds with a clear start, middle and end.');
    if (m.fillers >= 4) tips.push(`${m.fillers} filler words. Replace them with a short pause.`);
    if (m.wpm > 165) tips.push(`Pace ${m.wpm} words/min is fast. Target 120–150.`);
    if (m.wpm && m.wpm < 90) tips.push(`Pace ${m.wpm} words/min is slow. Prepare the first sentence in advance.`);
    if (this.kind() === 'STAR story' && !/result|outcome|reduced|improved|saved/i.test(this.text)) tips.push('End with the Result: what changed because of your action.');
    this.feedback.set(tips);
    this.stage.set('review');
    if (this.text.trim()) {
      this.aiBusy.set(true);
      const p = this.user.profile();
      const ai = await this.ai.speakingFeedback(this.prompt(), this.text, { role: p?.targetRole, years: p?.yearsExperience });
      if (ai) this.feedback.set([...tips, ...ai]);
      this.aiBusy.set(false);
    }
  }
  rate(d: CommDimension, n: number) {
    this.ratings.update(r => ({ ...r, [d]: n }));
  }
  retry() {
    this.ratings.set({});
    this.begin(this.voice.sttSupported && !!this.metrics()?.wpm);
  }
  async save() {
    this.saving.set(true);
    this.error.set('');
    const s: CommunicationSession = {
      type: this.kind(), questionId: this.question()?.id, prompt: this.prompt(), transcript: this.text.slice(0, 8000), durationSec: this.duration(),
      metrics: this.metrics()!, selfRating: Math.round(this.avgRating()), ratings: this.ratings(), feedback: this.feedback(), date: this.clock.today(),
    };
    try {
      await this.comm.save(s);
      await this.sessions.end();
      await this.plan.ensureToday();
      await this.plan.completeMatching('communication');
      this.stage.set('saved');
    } catch (e) {
      this.error.set('Could not save: ' + errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
  reset() {
    this.ratings.set({});
    this.feedback.set([]);
    this.metrics.set(null);
    this.shuffle();
    this.stage.set('pick');
  }
}
