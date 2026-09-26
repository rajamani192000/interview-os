import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { speechMetrics } from '../core/logic/scoring';
import { ratingFromScore } from '../core/logic/srs';
import { InterviewTurn, Question, VoiceSession } from '../core/models';
import { AIInterviewService, PROVIDERS } from '../core/services/ai.service';
import { ProjectService } from '../core/services/career.service';
import { MasterDataStore, TopicService } from '../core/services/master-data.service';
import { DailyPlanService, StudySessionService } from '../core/services/plan.service';
import { ToastService } from '../core/services/platform.service';
import { AttemptService, RevisionService } from '../core/services/practice.service';
import { VOICE_MODES, VoiceInterviewService } from '../core/services/speaking.service';
import { SettingsService, UserService } from '../core/services/user.service';
import { ListenSession, RecordingService, VoiceService } from '../core/services/voice.service';
import { errorMessage, uid } from '../core/util';
import { UI } from '../shared/ui';

interface Item { questionId?: string; question: string; isFollowUp?: boolean; parent?: Question; }

/**
 * AI VOICE INTERVIEW: interviewer asks (TTS) → you speak (STT) → evaluation (AI provider or offline
 * key-point check) → one follow-up → next. Summary + VoiceSession saved to Firestore; bank questions
 * also get an attempt so revision schedules update.
 */
@Component({
  selector: 'app-voice',
  imports: [FormsModule, RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    <app-page-header title="AI Voice Interview" [subtitle]="providerLabel()" />
    @switch (stage()) {
      @case ('pick') {
        @if (!aiReady()) { <div class="banner info small">No AI configured — answers are checked against the key points of your own model answers. <a routerLink="/app/settings" [queryParams]="{ tab: 'ai' }">Set up AI</a></div> }
        @if (!voice.sttSupported) { <div class="banner warn small">Speech recognition isn't supported in this browser, so you'll type your answers. {{ voice.ttsSupported ? 'Questions will still be read aloud.' : '' }}</div> }
        <div class="grid two">
          @for (m of modes; track m.id) {
            <button class="card stack" style="text-align:left;cursor:pointer;font:inherit;color:inherit" [style.border-color]="mode() === m.id ? 'var(--primary)' : ''" (click)="mode.set(m.id)">
              <b>{{ m.label }}</b><span class="small muted">{{ m.note }}</span></button>
          }
        </div>
        <button class="btn primary big block" (click)="start()" [disabled]="busy()">Start interview</button>
        <section class="card stack">
          <h3>Past sessions</h3>
          @for (s of sessions().slice(0, 8); track s.id) {
            <button class="list-item clickable" style="background:none;border:0;border-bottom:1px solid var(--border);font:inherit;color:inherit;text-align:left" (click)="view.set(s)">
              <span class="grow small">{{ labelOf(s.mode) }} · {{ s.date }} · {{ s.turns.length }} answers</span><span class="badge {{ s.overall >= 70 ? 'good' : s.overall >= 45 ? 'warn' : 'bad' }}">{{ s.overall }}</span></button>
          } @empty { <p class="small muted" style="margin:0">No voice interviews yet.</p> }
        </section>
        @if (view(); as v) {
          <app-modal [title]="labelOf(v.mode) + ' · ' + v.date" (closed)="view.set(null)">
            <div class="small muted">Technical {{ v.technicalScore ?? v.overall }} · Communication {{ v.communicationScore ?? '–' }} · Confidence {{ v.confidence ?? '–' }}/5</div>
            @for (t of v.turns; track $index) { <div class="card slim stack" style="gap:4px"><b class="small">{{ t.question }}</b><div class="small pre">{{ t.answer || '—' }}</div><span class="xs muted">Score {{ t.score }} · {{ t.feedback.join(' ') }}</span>
              @if (t.recordingRef) { <div><button class="btn sm" (click)="play(t.recordingRef)">▶ Play my answer</button></div> }</div> }
            @if (v.suggestions?.length) { <b class="small">Suggestions</b> @for (x of v.suggestions; track $index) { <div class="small">• {{ x }}</div> } }
          </app-modal>
        }
      }
      @case ('run') {
        @if (item(); as it) {
          <div class="row between small muted"><span>{{ it.isFollowUp ? 'Follow-up' : 'Question ' + (qIndex() + 1) + ' of ' + baseCount() }}</span><button class="btn ghost sm" (click)="end()">End interview</button></div>
          <app-bar [value]="(qIndex() / baseCount()) * 100" />
          <section class="card stack">
            <div class="row"><span class="badge">{{ it.isFollowUp ? 'Interviewer follow-up' : 'Interviewer' }}</span>@if (voice.speaking()) { <span class="small muted">speaking…</span> }</div>
            <h2>{{ it.question }}</h2>
            @if (voice.ttsSupported) { <div><button class="btn ghost sm" (click)="voice.speak(it.question)">🔊 Repeat question</button></div> }
            @if (phase() === 'answer') {
              @if (listen(); as l) {
                <div class="row small"><span class="mic-dot"></span><span class="muted">Listening… answer as you would in the interview</span></div>
                <div class="card slim small" style="min-height:90px;background:var(--surface-2)">{{ l.text() }} <span class="muted">{{ l.interim() }}</span></div>
                @if (l.error()) { <div class="banner warn small">{{ l.error() }}</div> }
                <button class="btn primary big block" (click)="submit()">Done answering</button>
              } @else {
                <textarea class="input" rows="6" [(ngModel)]="typed" placeholder="Type your answer"></textarea>
                <div class="grid two">
                  @if (voice.sttSupported) { <button class="btn big" (click)="mic()">🎙 Answer by voice</button> }
                  <button class="btn primary big" (click)="submit()" [disabled]="!typed.trim()">Submit answer</button>
                </div>
              }
            } @else if (phase() === 'evaluating') {
              <div class="row"><div class="spinner"></div><span>Evaluating your answer…</span></div>
            } @else if (lastTurn(); as t) {
              <div class="banner {{ t.score >= 70 ? 'good' : t.score >= 45 ? 'warn' : 'bad' }} small"><b>Score {{ t.score }}/100</b>
                @for (f of t.feedback; track $index) { <div>• {{ f }}</div> }
                @if (t.missed.length) { <div><b>Missed:</b> {{ t.missed.join('; ') }}</div> }</div>
              <button class="btn primary big block" (click)="advance()">{{ hasNext() ? 'Next question →' : 'Finish interview' }}</button>
            }
          </section>
        }
      }
      @case ('summary') {
        <section class="card stack">
          <h2>Interview summary</h2>
          <div class="grid stats">
            <div class="stat"><span class="eyebrow">Technical</span><b>{{ summary().technical }}</b></div>
            <div class="stat"><span class="eyebrow">Communication</span><b>{{ summary().communication }}</b></div>
            <div class="stat"><span class="eyebrow">Answer quality</span><b>{{ summary().quality }}</b></div>
            <div class="stat"><span class="eyebrow">Answers</span><b>{{ turns().length }}</b></div>
          </div>
          <div class="field"><span class="label">How confident did you feel? (1–5)</span>
            <div class="row">@for (n of [1, 2, 3, 4, 5]; track n) { <button class="chip" [class.on]="confidence() === n" (click)="confidence.set(n)">{{ n }}</button> }</div></div>
          @if (summary().weakTopics.length) { <div class="small"><b>Weak topics:</b> {{ summary().weakTopics.join(', ') }}</div> }
          @if (summary().suggestions.length) { <b class="small">Improvement suggestions</b> @for (x of summary().suggestions; track $index) { <div class="small">• {{ x }}</div> } }
          @if (error()) { <div class="banner bad small">{{ error() }} <button class="btn sm" (click)="save()">Retry</button></div> }
          @if (!saved()) { <button class="btn primary big block" (click)="save()" [disabled]="busy() || !confidence()">{{ busy() ? 'Saving…' : 'Save interview' }}</button> }
          @else {
            <div class="banner good small">Saved. Bank questions were added to your revision schedule.</div>
            @if (fromPlan && plan.progress().next; as n) { <a class="btn primary block" [routerLink]="n.type === 'communication' ? '/app/communication' : '/app/practice'" [queryParams]="n.type === 'communication' ? { plan: 1 } : { source: 'plan' }">Next: {{ n.title }} →</a> }
            @else { <a class="btn primary block" routerLink="/app/today">Back to Today</a> }
            <button class="btn block" (click)="stage.set('pick')">Another interview</button>
          }
        </section>
      }
    }
  </div>`,
})
export class VoiceComponent implements OnInit, OnDestroy {
  voice = inject(VoiceService);
  plan = inject(DailyPlanService);
  private svc = inject(VoiceInterviewService);
  private ai = inject(AIInterviewService);
  private md = inject(MasterDataStore);
  private topics = inject(TopicService);
  private attempts = inject(AttemptService);
  private revision = inject(RevisionService);
  private projects = inject(ProjectService);
  private recordings = inject(RecordingService);
  private settings = inject(SettingsService);
  private user = inject(UserService);
  private study = inject(StudySessionService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  modes = VOICE_MODES;
  mode = signal<VoiceSession['mode']>('quick');
  stage = signal<'pick' | 'run' | 'summary'>('pick');
  phase = signal<'answer' | 'evaluating' | 'result'>('answer');
  queue = signal<Item[]>([]);
  pos = signal(0);
  turns = signal<InterviewTurn[]>([]);
  listen = signal<ListenSession | null>(null);
  busy = signal(false);
  saved = signal(false);
  error = signal('');
  confidence = signal<number | null>(null);
  aiReady = signal(false);
  view = signal<VoiceSession | null>(null);
  typed = '';
  fromPlan = false;
  private started = 0;
  private qStart = 0;
  private spokenText = '';
  private spokenSec = 0;
  private sessionId = '';

  sessions = computed(() => [...this.svc.items()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  item = computed(() => this.queue()[this.pos()] ?? null);
  baseCount = computed(() => this.queue().filter(i => !i.isFollowUp).length || 1);
  qIndex = computed(() => this.queue().slice(0, this.pos() + 1).filter(i => !i.isFollowUp).length - 1);
  lastTurn = computed(() => this.turns()[this.turns().length - 1] ?? null);
  hasNext = computed(() => this.pos() + 1 < this.queue().length);
  providerLabel = computed(() => 'Evaluator: ' + (PROVIDERS.find(p => p.id === this.settings.settings().ai.provider)?.label ?? 'No AI'));
  summary = computed(() => {
    const t = this.turns();
    const technical = t.length ? Math.round(t.reduce((n, x) => n + x.score, 0) / t.length) : 0;
    const allText = t.map(x => x.answer).join(' ');
    const secs = t.reduce((n, x) => n + x.durationSec, 0);
    const m = speechMetrics(allText, this.spokenSec ? secs : 0);
    let communication = 100;
    if (m.fillers) communication -= Math.min(30, m.fillers * 3);
    if (m.wpm && (m.wpm > 170 || m.wpm < 90)) communication -= 15;
    const avgWords = t.length ? m.words / t.length : 0;
    if (avgWords < 40) communication -= 20;
    const quality = t.length ? Math.round(t.reduce((n, x) => n + Math.min(100, (x.answer.split(/\s+/).length / 120) * 50 + x.score * 0.5), 0) / t.length) : 0;
    const weakTopics = [...new Set(t.filter(x => x.score < 60 && x.questionId).map(x => this.topics.name(this.md.questionMap().get(x.questionId!)?.topicId || '')))].filter(n => n !== '—');
    const suggestions = [...new Set(t.flatMap(x => x.feedback).filter(f => !/^AI unavailable/.test(f)))].slice(0, 6);
    return { technical, communication: Math.max(0, communication), quality, weakTopics, suggestions, metrics: m };
  });

  async ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    this.fromPlan = !!q.get('plan');
    const m = q.get('mode') as VoiceSession['mode'] | null;
    if (m && VOICE_MODES.some(x => x.id === m)) this.mode.set(m);
    this.aiReady.set(this.settings.settings().ai.provider !== 'none' && (await this.ai.ready()).ok);
    await Promise.all([this.md.ensureLoaded(), this.svc.ensureLoaded(), this.revision.ensureLoaded(), this.attempts.ensureLoaded(), this.projects.ensureLoaded()]).catch(e => this.toast.bad(errorMessage(e)));
  }
  ngOnDestroy() {
    this.listen()?.stop();
    this.voice.stopSpeaking();
  }
  private audio: HTMLAudioElement | null = null;
  /** Plays a saved answer recording (device IndexedDB or Firebase Storage). */
  async play(ref: string) {
    try {
      const blob = await this.recordings.load(ref);
      if (!blob) { this.toast.bad('Recording not found on this device.'); return; }
      this.audio?.pause();
      this.audio = new Audio(URL.createObjectURL(blob));
      await this.audio.play();
    } catch (e) { this.toast.bad('Could not play the recording: ' + errorMessage(e)); }
  }
  labelOf(m: string) { return VOICE_MODES.find(x => x.id === m)?.label ?? m; }

  async start() {
    const items = this.svc.pick(this.mode(), this.projects.items());
    if (!items.length) { this.toast.bad(this.md.questions().length ? 'No questions match this mode yet. Try another mode.' : 'Your question bank is empty.'); return; }
    this.queue.set(items.map(i => ({ ...i, parent: i.questionId ? this.md.questionMap().get(i.questionId) : undefined })));
    this.pos.set(0);
    this.turns.set([]);
    this.saved.set(false);
    this.confidence.set(null);
    this.spokenSec = 0;
    this.sessionId = uid('v');
    this.started = Date.now();
    this.study.begin('practice');
    this.stage.set('run');
    this.ask();
  }
  private async ask() {
    this.phase.set('answer');
    this.typed = '';
    this.spokenText = '';
    this.qStart = Date.now();
    const it = this.item();
    if (it) {
      await this.voice.speak(it.question);
      if (this.voice.sttSupported && this.stage() === 'run' && this.phase() === 'answer' && !this.listen()) this.mic();
    }
  }
  mic() {
    const rec = this.settings.settings().voice.saveRecordings !== 'none';
    this.listen.set(this.voice.listen({ record: rec }));
  }
  async submit() {
    const it = this.item();
    if (!it) return;
    let text = this.typed.trim();
    let dur = Math.round((Date.now() - this.qStart) / 1000);
    let recordingRef: string | undefined;
    const l = this.listen();
    if (l) {
      const r = await l.stop();
      this.listen.set(null);
      text = (text + ' ' + r.text).trim();
      dur = r.durationSec;
      this.spokenSec += r.durationSec;
      recordingRef = await this.recordings.save(`${this.sessionId}-${this.pos()}`, r.audio).catch(() => undefined);
    }
    this.phase.set('evaluating');
    const ref = it.parent ?? { question: it.question, answer: '', keyPoints: [] };
    const p = this.user.profile();
    const ev = await this.ai.evaluate({ question: it.question, answer: ref.answer, keyPoints: it.isFollowUp ? [] : ref.keyPoints }, text, l ? dur : 0, { role: p?.targetRole, years: p?.yearsExperience, mode: this.mode() });
    const turn: InterviewTurn = { questionId: it.isFollowUp ? undefined : it.questionId, question: it.question, answer: text, score: ev.score, feedback: ev.feedback, missed: ev.missed, durationSec: dur, recordingRef };
    this.turns.update(t => [...t, turn]);
    // one follow-up per main question: AI's follow-up, else the bank's first follow-up
    if (!it.isFollowUp) {
      const fu = ev.followUp || it.parent?.followUps?.[0];
      if (fu) this.queue.update(q => [...q.slice(0, this.pos() + 1), { question: fu, isFollowUp: true, parent: it.parent }, ...q.slice(this.pos() + 1)]);
    }
    this.phase.set('result');
  }
  advance() {
    if (!this.hasNext()) { this.end(); return; }
    this.pos.set(this.pos() + 1);
    this.ask();
  }
  async end() {
    this.voice.stopSpeaking();
    const l = this.listen();
    if (l) { await l.stop(); this.listen.set(null); }
    if (!this.turns().length) { this.stage.set('pick'); await this.study.end().catch(() => undefined); return; }
    this.stage.set('summary');
  }
  async save() {
    this.busy.set(true);
    this.error.set('');
    const s = this.summary();
    const session: VoiceSession = {
      mode: this.mode(), provider: this.settings.settings().ai.provider, turns: this.turns(), overall: s.technical, technicalScore: s.technical,
      communicationScore: s.communication, confidence: this.confidence() ?? undefined, weakTopics: s.weakTopics, suggestions: s.suggestions, metrics: s.metrics, date: this.svc.today(),
    };
    try {
      await this.svc.save(session, this.sessionId);
      for (const t of this.turns()) {
        const q = t.questionId ? this.md.questionMap().get(t.questionId) : undefined;
        if (q) await this.attempts.record(q, { mode: 'voice', rating: ratingFromScore(t.score), score: t.score, confidence: this.confidence() || 3, durationSec: t.durationSec, answerText: t.answer });
      }
      await this.study.end();
      await this.plan.ensureToday();
      await this.plan.completeMatching('voice');
      this.saved.set(true);
    } catch (e) {
      this.error.set('Could not save: ' + errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
