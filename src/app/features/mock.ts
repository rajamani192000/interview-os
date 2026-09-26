import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { isIdk, LEVEL_NAMES, mainCount, NextStep } from '../core/logic/mock-engine';
import { EXPERIENCE_LEVELS, MOCK_ROLES, MOCK_TYPES, MockConfig, MockInterview, MockReport, MockType } from '../core/models';
import { JobService } from '../core/services/career.service';
import { CategoryService, MasterDataStore, TopicService } from '../core/services/master-data.service';
import { DEFAULT_MOCK_CONFIG, MockEngineService, SkillProgressService } from '../core/services/mock.service';
import { StudySessionService } from '../core/services/plan.service';
import { ToastService } from '../core/services/platform.service';
import { MockInterviewService } from '../core/services/speaking.service';
import { SettingsService } from '../core/services/user.service';
import { ListenSession, VoiceService } from '../core/services/voice.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

type View = 'home' | 'setup' | 'live' | 'report' | 'detail';
type Tab = 'new' | 'history' | 'progress';
type Mood = 'listening' | 'thinking' | 'followup' | 'warning' | 'done';
type Live = MockInterview & { id: string };

const TYPE_HELP: Record<MockType, string> = {
  Technical: 'Concepts and coding from your chosen technologies, adapting to your answers.',
  HR: 'Behavioural questions, motivation and career story.',
  Managerial: 'Your projects, prioritisation, ownership and team scenarios.',
  'Full Mock': 'Introduction → technical → project → behavioural, like a real loop.',
  'Company-specific': 'Tailored to a job you track: its JD gaps, “why this company”, and your projects.',
  'Role-specific': 'Questions matched to the role you pick, plus a project round.',
};
const MOOD: Record<Mood, { icon: string; label: string }> = {
  listening: { icon: '🟢', label: 'Listening' }, thinking: { icon: '🔵', label: 'Thinking' }, followup: { icon: '🟡', label: 'Follow-up' },
  warning: { icon: '🔴', label: 'Time warning' }, done: { icon: '✅', label: 'Interview completed' },
};

@Component({
  selector: 'app-mock',
  imports: [FormsModule, RouterLink, DatePipe, NgTemplateOutlet, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .chat { display: flex; flex-direction: column; gap: 10px; max-height: 52vh; overflow-y: auto; padding: 4px; }
    .bubble { padding: 10px 12px; border-radius: 14px; max-width: 88%; white-space: pre-wrap; line-height: 1.5; }
    .ai { background: var(--surface-2); align-self: flex-start; border-bottom-left-radius: 4px; }
    .me { background: var(--primary-soft); align-self: flex-end; border-bottom-right-radius: 4px; }
    .who { font-size: .72rem; color: var(--muted); font-weight: 700; margin-bottom: 2px; }
    .mood { display: inline-flex; gap: 6px; align-items: center; font-weight: 700; font-size: .85rem; }
    .score-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); }
    .trend span { display: inline-block; min-width: 38px; text-align: center; }
  `,
  template: `<div class="page stack" style="max-width:860px">
    @switch (view()) {
      @case ('home') {
        <app-page-header title="Mock Interview" subtitle="A real interview: one question at a time, follow-ups, adaptive difficulty and a full report" />
        <div class="tabs">
          <button class="chip" [class.on]="tab() === 'new'" (click)="tab.set('new')">New interview</button>
          <button class="chip" [class.on]="tab() === 'history'" (click)="tab.set('history')">My Mock Interviews ({{ completed().length }})</button>
          <button class="chip" [class.on]="tab() === 'progress'" (click)="tab.set('progress')">Progress</button>
        </div>
        @if (loading()) { <app-loading /> }
        @else if (tab() === 'new') {
          @if (inProgress(); as ip) {
            <div class="banner info small row between"><span>Unfinished interview from {{ ip.date }} ({{ ip.title }}).</span>
              <span class="row"><button class="btn sm primary" (click)="resume(ip)">Resume</button><button class="btn sm ghost" (click)="discard(ip)">Finish with report</button></span></div>
          }
          @if (!md.questions().length) { <app-empty title="No questions yet" text="Technical rounds use your question bank. HR and managerial rounds still work with standard prompts and your projects." /> }
          <div class="grid three">
            @for (t of types; track t) {
              <button class="card stack" style="text-align:left;cursor:pointer;font:inherit;color:inherit;gap:4px" (click)="pickType(t)" [attr.aria-label]="t">
                <b>{{ t }} Interview</b><span class="small muted">{{ typeHelp[t] }}</span></button>
            }
          </div>
        } @else if (tab() === 'history') {
          @for (m of completed(); track m.id) {
            <button class="card stack" style="text-align:left;cursor:pointer;font:inherit;color:inherit;gap:2px" (click)="openDetail(m)">
              <div class="row between"><b>{{ m.title }}</b><span class="badge {{ cls(m.overall ?? 0) }}">Score: {{ m.overall ?? '—' }}%</span></div>
              <span class="small muted">{{ m.date | date: 'MMM d, y' }} · {{ mins(m.durationSec) }} min{{ m.report?.scores?.technical !== null && m.report?.scores?.technical !== undefined ? ' · Technical: ' + m.report!.scores.technical + '%' : '' }}{{ m.report ? ' · Communication: ' + m.report.scores.communication + '%' : '' }}</span>
            </button>
          } @empty { <app-empty title="No mock interviews yet" text="Your completed interviews, transcripts and reports appear here." /> }
        } @else {
          @if (!completed().length) { <app-empty title="No progress yet" text="Complete a mock interview to start tracking your scores by topic." /> }
          @else {
            <section class="card stack">
              <h3 style="margin:0">Overall score by interview</h3>
              @for (m of chronological(); track m.id; let i = $index) {
                <div class="row" style="gap:10px"><span class="small nowrap" style="width:110px">Interview #{{ i + 1 }}</span><div class="grow"><app-bar [value]="m.overall ?? 0" /></div><b class="small nowrap" style="width:44px;text-align:right">{{ m.overall ?? 0 }}%</b></div>
              }
              @if (chronological().length >= 2) { <p class="small muted" style="margin:0">Change since your first interview: <b>{{ delta() >= 0 ? '+' : '' }}{{ delta() }} points</b>.</p> }
            </section>
            <section class="card stack">
              <h3 style="margin:0">By topic</h3>
              <div class="table-wrap"><table class="table"><thead><tr><th>Topic</th><th>Recent scores (oldest → newest)</th><th>Average</th><th>Trend</th></tr></thead><tbody>
                @for (s of skillRows(); track s.topicId) {
                  <tr><td>{{ s.name }}</td><td class="trend">@for (x of s.samples.slice(-6); track $index) { <span class="badge {{ cls(x.score) }}">{{ x.score }}</span> }</td><td>{{ s.avg }}%</td><td>{{ s.trend > 0 ? '▲ +' + s.trend : s.trend < 0 ? '▼ ' + s.trend : '—' }}</td></tr>
                } @empty { <tr><td colspan="4" class="muted">Topic scores appear after technical questions.</td></tr> }
              </tbody></table></div>
            </section>
          }
        }
      }

      @case ('setup') {
        <app-page-header [title]="cfg.type + ' Interview'" subtitle="Configure your interview" />
        <section class="card stack">
          <div class="field"><span class="label">Interview type</span><div class="row">@for (t of types; track t) { <button type="button" class="chip" [class.on]="cfg.type === t" (click)="cfg.type = t">{{ t }}</button> }</div></div>
          @if (cfg.type === 'Company-specific') {
            <div class="field"><label for="mj">Job</label><select id="mj" class="input" [(ngModel)]="cfg.jobId"><option [ngValue]="undefined">— choose a tracked job —</option>@for (j of jobs.items(); track j.id) { <option [value]="j.id">{{ j.company }} — {{ j.title }}</option> }</select>
              @if (!jobs.items().length) { <span class="hint">Add a job with its description on the Jobs page first.</span> }</div>
          }
          <div class="grid two">
            <div class="field"><label for="mr">Job role</label><select id="mr" class="input" [(ngModel)]="cfg.role">@for (r of roles; track r) { <option [value]="r">{{ r }}</option> }</select></div>
            <div class="field"><label for="me">Experience level</label><select id="me" class="input" [(ngModel)]="cfg.experience">@for (e of levels; track e) { <option [value]="e">{{ e }}</option> }</select></div>
            <div class="field"><label for="md">Difficulty</label><select id="md" class="input" [(ngModel)]="cfg.difficulty"><option>Easy</option><option>Medium</option><option>Hard</option></select><span class="hint">Starting level; it adapts to your answers.</span></div>
            <div class="field"><label for="ms">Interview style</label><select id="ms" class="input" [(ngModel)]="cfg.style"><option>Friendly</option><option>Professional</option><option>Challenging</option></select></div>
            <div class="field"><label for="mu">Duration</label><select id="mu" class="input" [(ngModel)]="cfg.durationMin"><option [ngValue]="15">15 minutes</option><option [ngValue]="30">30 minutes</option><option [ngValue]="45">45 minutes</option><option [ngValue]="60">60 minutes</option></select></div>
            <div class="field"><label for="mn">Number of questions</label><input id="mn" class="input" type="number" min="2" max="20" [(ngModel)]="cfg.questionCount" /><span class="hint">Main questions; follow-ups are extra.</span></div>
          </div>
          <div class="field"><span class="label">Technology (from your question bank)</span><div class="row">
            @for (c of cats.list(); track c.id) { <button type="button" class="chip" [class.on]="cfg.technologies.includes(c.id)" (click)="toggleTech(c.id)">{{ c.name }} ({{ count(c.id) }})</button> }
            @empty { <span class="small muted">No categories yet.</span> }
          </div><span class="hint">{{ cfg.technologies.length ? '' : 'None selected = all technologies. ' }}Only technologies in your bank can be asked; nothing is generated.</span></div>
          @if (cfg.focusTopicIds?.length) { <div class="banner info small">Improvement interview: focusing on {{ focusNames() }}.</div> }
          <label class="check small"><input type="checkbox" [(ngModel)]="speakAloud" /> Interviewer speaks questions aloud</label>
          <div class="small muted">Evaluator: {{ aiLabel() }}</div>
          @if (setupError()) { <div class="banner bad small">{{ setupError() }}</div> }
          <div class="row"><button class="btn" (click)="view.set('home')">Back</button><button class="btn primary big grow" (click)="begin()" [disabled]="busy()">{{ busy() ? 'Starting…' : 'Start interview' }}</button></div>
        </section>
      }

      @case ('live') {
        @if (live(); as m) {
          <div class="row between">
            <span class="mood" [attr.aria-label]="'Interviewer: ' + moodInfo().label" role="status">{{ moodInfo().icon }} {{ moodInfo().label }}</span>
            <span class="small"><b [style.color]="remaining() <= 120 ? 'var(--bad)' : ''">⏱ {{ clock(remaining()) }}</b> left · Q {{ Math.min(mainDone() + (step()?.kind === 'question' || step()?.kind === 'project' || step()?.kind === 'behavioral' ? 1 : 0), m.config!.questionCount) }}/{{ m.config!.questionCount }} · level {{ levelName() }}</span>
          </div>
          <app-bar [value]="(elapsed() / (m.config!.durationMin * 60)) * 100" />
          <section class="card stack">
            <div class="chat" #chat aria-live="polite">
              @for (t of m.mturns || []; track t.n) {
                <div class="bubble ai"><div class="who">Interviewer</div>{{ t.prompt }}</div>
                <div class="bubble me"><div class="who">You</div>{{ t.idk ? "I don't know." : t.answer || '—' }}</div>
              }
              @if (step(); as s) { @if (s.kind !== 'end') { <div class="bubble ai"><div class="who">Interviewer{{ s.kind === 'followup' ? ' · follow-up' : '' }}</div>{{ s.prompt }}</div> } }
              @if (mood() === 'thinking') { <div class="bubble ai muted"><div class="who">Interviewer</div>…</div> }
            </div>
            @if (mood() !== 'thinking' && mood() !== 'done') {
              @if (listen(); as l) {
                <div class="card slim small" style="min-height:70px;background:var(--surface-2)"><span class="mic-dot" style="display:inline-block"></span> {{ l.text() }} <span class="muted">{{ l.interim() }}</span></div>
                @if (l.error()) { <div class="banner warn small">{{ l.error() }}</div> }
                <div class="row"><button class="btn primary big grow" (click)="send()">Done answering</button></div>
              } @else {
                <textarea class="input" rows="4" [(ngModel)]="typed" placeholder="Type your answer, or use the microphone" aria-label="Your answer" (keydown.control.enter)="send()"></textarea>
                <div class="row">
                  @if (voice.sttSupported) { <button class="btn" (click)="mic()">🎙 Speak</button> }
                  <button class="btn ghost" (click)="dontKnow()">I don't know</button>
                  <button class="btn primary grow" (click)="send()" [disabled]="!typed.trim()">Send answer</button>
                </div>
              }
            }
            @if (error()) { <div class="banner bad small">{{ error() }}</div> }
          </section>
          <div class="row between"><span class="xs muted">Feedback is held back until the end, like a real interview.</span><button class="btn ghost sm" (click)="endNow()">End interview</button></div>
        }
      }

      @case ('report') { @if (live(); as m) { @if (m.report; as r) {
        <app-page-header title="Mock Interview Score" [subtitle]="m.title + ' · ' + mins(m.durationSec) + ' min'" />
        <ng-container *ngTemplateOutlet="reportTpl; context: { m, r }" />
        <div class="row"><button class="btn primary" (click)="back()">Done</button><button class="btn" (click)="view.set('detail')">View transcript</button></div>
      } } }

      @case ('detail') { @if (live(); as m) {
        <app-page-header [title]="m.title" [subtitle]="(m.date | date: 'MMM d, y') + ' · ' + mins(m.durationSec) + ' min'"><button class="btn" (click)="back()">Back</button></app-page-header>
        @if (m.report; as r) { <ng-container *ngTemplateOutlet="reportTpl; context: { m, r }" /> }
        @else { <div class="card small">This interview was recorded with the earlier mock format. Score {{ m.overall ?? '—' }}.
          @for (s of m.strengths || []; track $index) { <div>✓ {{ s }}</div> } @for (s of m.improvements || []; track $index) { <div>→ {{ s }}</div> }</div> }
        <section class="card stack">
          <h3 style="margin:0">Transcript</h3>
          @for (t of m.mturns || []; track t.n) {
            <div class="stack" style="gap:4px;border-bottom:1px solid var(--border);padding-bottom:8px">
              <div class="small"><b>Interviewer{{ t.kind === 'followup' ? ' (follow-up)' : '' }}:</b> {{ t.prompt }}</div>
              <div class="small"><b>You:</b> {{ t.idk ? "I don't know." : t.answer || '—' }}</div>
              @if (t.eval) { <div class="xs muted">Score {{ t.eval.score }} · correctness {{ t.eval.correctness }} · completeness {{ t.eval.completeness }} · communication {{ t.eval.communication }} · confidence {{ t.eval.confidence }}{{ t.eval.examples ? ' · example used' : '' }}{{ t.eval.missed.length ? ' · missed: ' + t.eval.missed.join('; ') : '' }}</div> }
            </div>
          } @empty { @for (t of m.turns; track $index) { <div class="small"><b>{{ t.question }}</b><div class="muted">{{ t.answer }}</div></div> } }
        </section>
      } }
    }

    <ng-template #reportTpl let-m="m" let-r="r">
      <section class="card stack">
        <div class="score-row" style="font-size:1.1rem"><b>Overall</b><b>{{ r.scores.overall }}%</b></div>
        @for (row of scoreRows(r); track row.label) { <div class="score-row"><span>{{ row.label }}</span><span>{{ row.value === null ? 'not assessed' : row.value + '%' }}</span></div> }
      </section>
      <div class="grid two">
        <section class="card stack"><h3 style="margin:0">What you did well</h3>
          @for (s of r.strengths; track s) { <div class="small">✓ {{ s }}</div> } @empty { <p class="small muted" style="margin:0">Keep going — strengths show up as your scores rise.</p> }</section>
        <section class="card stack"><h3 style="margin:0">Needs improvement</h3>
          @for (s of r.improvements; track s) { <div class="small">→ {{ s }}</div> } @empty { <p class="small muted" style="margin:0">No major gaps in this interview.</p> }</section>
      </div>
      @if (r.struggled.length) {
        <section class="card stack"><h3 style="margin:0">Questions you struggled with</h3>
          @for (s of r.struggled; track $index) {
            <details class="card slim"><summary style="cursor:pointer"><b class="small">{{ s.prompt }}</b></summary>
              <div class="small" style="margin-top:6px"><b>Your answer:</b> {{ s.answer || '—' }}</div>
              @if (s.missed.length) { <div class="small"><b>What was missing:</b> {{ s.missed.join('; ') }}</div> }
              <div class="small"><b>Better answer:</b></div><div class="answer small">{{ s.betterAnswer }}</div>
            </details>
          }
        </section>
      }
      <section class="card stack">
        <h3 style="margin:0">Practice your weak areas</h3>
        @for (c of r.weakCategories; track c.categoryId) { <button class="btn block" (click)="improve(c.categoryId, r)">Start {{ c.name }} Improvement Interview ({{ c.score }}%)</button> }
        @if (r.communicationWeak) { <a class="btn block" routerLink="/app/communication">Start Communication Practice</a> }
        @if (struggledIds(r).length) { <a class="btn block" routerLink="/app/practice" [queryParams]="{ ids: struggledIds(r).join(',') }">Practise the {{ struggledIds(r).length }} question(s) you missed</a> }
        @if (!r.weakCategories.length && !r.communicationWeak && !struggledIds(r).length) { <p class="small muted" style="margin:0">No weak areas detected. Try a harder or Challenging interview next.</p> }
      </section>
    </ng-template>
  </div>`,
})
export class MockComponent implements OnInit, OnDestroy {
  md = inject(MasterDataStore);
  cats = inject(CategoryService);
  jobs = inject(JobService);
  voice = inject(VoiceService);
  private topics = inject(TopicService);
  private engine = inject(MockEngineService);
  private mocks = inject(MockInterviewService);
  private skills = inject(SkillProgressService);
  private settings = inject(SettingsService);
  private study = inject(StudySessionService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  Math = Math;
  types = MOCK_TYPES;
  typeHelp = TYPE_HELP;
  roles = MOCK_ROLES;
  levels = EXPERIENCE_LEVELS;
  chat = viewChild<ElementRef<HTMLElement>>('chat');

  view = signal<View>('home');
  tab = signal<Tab>('new');
  loading = signal(true);
  busy = signal(false);
  error = signal('');
  setupError = signal('');
  live = signal<Live | null>(null);
  step = signal<NextStep | null>(null);
  mood = signal<Mood>('listening');
  listen = signal<ListenSession | null>(null);
  elapsed = signal(0);
  cfg: MockConfig = structuredClone(DEFAULT_MOCK_CONFIG);
  typed = '';
  speakAloud = true;
  private answerStart = 0;
  private resumedAt = 0;
  private baseElapsed = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  completed = computed(() => this.mocks.items().filter(m => m.status === 'completed').sort((a, b) => (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0)));
  chronological = computed(() => [...this.completed()].reverse());
  delta = computed(() => { const c = this.chronological(); return c.length >= 2 ? (c[c.length - 1].overall ?? 0) - (c[0].overall ?? 0) : 0; });
  inProgress = computed(() => this.mocks.items().find(m => m.status === 'in-progress' && m.version === 2) as Live | undefined ?? null);
  skillRows = computed(() => this.skills.items().map(s => ({ ...s, trend: s.samples.length >= 2 ? s.samples[s.samples.length - 1].score - s.samples[0].score : 0 })).sort((a, b) => a.avg - b.avg));
  remaining = computed(() => Math.max(0, (this.live()?.config?.durationMin ?? 30) * 60 - this.elapsed()));
  mainDone = computed(() => mainCount(this.live()?.mturns || []));
  levelName = computed(() => LEVEL_NAMES[this.live()?.level ?? 1]);
  moodInfo = computed(() => MOOD[this.mood()]);
  aiLabel = computed(() => (this.settings.settings().ai.provider === 'none' ? 'Offline key-point check (set up AI in Settings for richer follow-ups)' : `AI (${this.settings.settings().ai.provider}) with offline fallback`));

  async ngOnInit() {
    try {
      await this.engine.ensureLoaded();
      const last = await this.engine.lastConfig();
      this.cfg = { ...DEFAULT_MOCK_CONFIG, experience: this.engine.experienceFromProfile(), ...(last || {}), focusTopicIds: undefined };
      const job = this.route.snapshot.queryParamMap.get('job');
      if (job && this.jobs.byId(job)) { this.cfg = { ...this.cfg, type: 'Company-specific', jobId: job }; this.view.set('setup'); }
    } catch (e) { this.toast.bad(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  ngOnDestroy() { this.stopTimer(); this.listen()?.stop(); this.voice.stopSpeaking(); }

  cls(n: number) { return n >= 75 ? 'good' : n >= 55 ? 'warn' : 'bad'; }
  mins(sec: number) { return Math.max(1, Math.round((sec || 0) / 60)); }
  clock(sec: number) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
  count(catId: string) { return this.md.questions().filter(q => q.categoryId === catId).length; }
  focusNames() { return (this.cfg.focusTopicIds || []).map(id => this.topics.name(id)).join(', '); }
  toggleTech(id: string) { this.cfg.technologies = this.cfg.technologies.includes(id) ? this.cfg.technologies.filter(x => x !== id) : [...this.cfg.technologies, id]; }
  pickType(t: MockType) { this.cfg = { ...this.cfg, type: t, focusTopicIds: undefined }; this.setupError.set(''); this.view.set('setup'); }
  scoreRows(r: MockReport) {
    return [{ label: 'Technical Knowledge', value: r.scores.technical }, { label: 'Problem Solving', value: r.scores.problemSolving }, { label: 'Communication', value: r.scores.communication }, { label: 'Confidence', value: r.scores.confidence }, { label: 'Project Knowledge', value: r.scores.project }];
  }
  struggledIds(r: MockReport) { return [...new Set(r.struggled.map(s => s.questionId).filter((x): x is string => !!x))]; }

  async begin() {
    this.setupError.set('');
    const c = this.cfg;
    if (c.type === 'Company-specific' && !c.jobId) return this.setupError.set('Choose the job this interview is for.');
    if (!(c.questionCount >= 2 && c.questionCount <= 20)) return this.setupError.set('Choose between 2 and 20 questions.');
    const techNeeded = c.type === 'Technical' || c.type === 'Role-specific' || c.type === 'Full Mock' || c.type === 'Company-specific';
    const pool = this.md.questions().filter(q => !c.technologies.length || c.technologies.includes(q.categoryId));
    if (techNeeded && !pool.length) return this.setupError.set('No questions in your bank for the selected technologies. Import questions or choose other technologies.');
    this.busy.set(true);
    try {
      const m = await this.engine.start({ ...c, questionCount: Math.round(c.questionCount) });
      this.open(m);
    } catch (e) { this.setupError.set(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  resume(m: Live) { this.open(m); }
  async discard(m: Live) { this.live.set(m); this.baseElapsed = m.durationSec; await this.complete(); }

  private open(m: Live) {
    this.live.set(m);
    this.error.set('');
    this.baseElapsed = m.durationSec || 0;
    this.resumedAt = Date.now();
    this.elapsed.set(this.baseElapsed);
    this.view.set('live');
    this.study.begin('practice');
    this.startTimer();
    this.ask();
  }
  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      this.elapsed.set(this.baseElapsed + Math.round((Date.now() - this.resumedAt) / 1000));
      if (this.mood() === 'listening' || this.mood() === 'followup') { if (this.remaining() <= 120 && this.remaining() > 0) this.mood.set('warning'); }
      if (this.remaining() <= 0 && this.mood() !== 'thinking' && this.mood() !== 'done') this.endNow();
    }, 1000);
  }
  private stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private ask() {
    const m = this.live()!;
    const s = this.engine.next({ ...m, durationSec: this.elapsed() });
    if (s.kind === 'end') { this.step.set(s); this.complete(); return; }
    this.step.set(s);
    this.typed = '';
    this.answerStart = Date.now();
    this.mood.set(this.remaining() <= 120 ? 'warning' : s.kind === 'followup' ? 'followup' : 'listening');
    this.scroll();
    if (this.speakAloud && this.voice.ttsSupported) this.voice.speak(s.prompt);
  }
  private scroll() { setTimeout(() => { const el = this.chat()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; }, 30); }

  mic() { this.voice.stopSpeaking(); this.listen.set(this.voice.listen()); }
  dontKnow() { this.typed = ''; this.submit("I don't know", true, false, Math.round((Date.now() - this.answerStart) / 1000)); }
  async send() {
    let text = this.typed.trim(), spoken = false;
    let dur = Math.round((Date.now() - this.answerStart) / 1000);
    const l = this.listen();
    if (l) { const r = await l.stop(); this.listen.set(null); text = (text + ' ' + r.text).trim(); dur = r.durationSec; spoken = true; }
    if (!text) { this.error.set('No answer captured. Type it, try the microphone again, or choose "I don’t know".'); return; }
    this.submit(text, isIdk(text), spoken, dur);
  }
  private async submit(text: string, idk: boolean, spoken: boolean, dur: number) {
    const m = this.live(), s = this.step();
    if (!m || !s || s.kind === 'end') return;
    this.error.set('');
    this.voice.stopSpeaking();
    this.mood.set('thinking');
    try {
      const next = await this.engine.answer(m, s, text, dur, spoken, idk, this.elapsed());
      this.live.set(next);
      if (s.kind === 'wrapup') { await this.complete(); return; }
      this.ask();
    } catch (e) {
      this.error.set('Could not save your answer: ' + errorMessage(e));
      this.mood.set('listening');
    }
  }
  async endNow() {
    this.listen()?.stop();
    this.listen.set(null);
    await this.complete();
  }
  private async complete() {
    const m = this.live();
    if (!m || m.status === 'completed' || this.busy()) return;
    this.busy.set(true);
    this.stopTimer();
    this.voice.stopSpeaking();
    this.mood.set('done');
    try {
      const done = await this.engine.finish(m, this.elapsed());
      this.live.set(done);
      await this.study.end().catch(() => undefined);
      this.view.set('report');
    } catch (e) { this.error.set(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  openDetail(m: MockInterview) { this.live.set(m as Live); this.view.set('detail'); }
  back() { this.live.set(null); this.step.set(null); this.view.set('home'); this.tab.set('history'); }
  improve(categoryId: string, r: MockReport) {
    const focus = r.weakTopicIds.filter(t => this.topics.get(t)?.categoryId === categoryId);
    this.cfg = { ...this.cfg, type: 'Technical', technologies: [categoryId], focusTopicIds: focus, questionCount: 5, durationMin: 15, difficulty: 'Medium' };
    this.live.set(null);
    this.view.set('setup');
  }
}
