import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RATING_SCORE } from '../core/logic/srs';
import { BOOKMARK_TAGS, BookmarkTag, Question, Rating, RevisionSchedule, SrsStatus } from '../core/models';
import { Evaluation, AIInterviewService } from '../core/services/ai.service';
import { CategoryService, MasterDataStore, TopicService } from '../core/services/master-data.service';
import { DailyPlanService, StudySessionService } from '../core/services/plan.service';
import { ClockService, ToastService } from '../core/services/platform.service';
import { AttemptService, BookmarkService, NoteService, RevisionService } from '../core/services/practice.service';
import { ProgressService } from '../core/services/progress.service';
import { UserService } from '../core/services/user.service';
import { ListenSession, VoiceService } from '../core/services/voice.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

type Stage = 'question' | 'learn' | 'answer' | 'self' | 'reference' | 'finished';
const RATINGS: { r: Rating; label: string; hint: string }[] = [
  { r: 'again', label: 'Couldn’t answer', hint: 'Review again tomorrow' },
  { r: 'hard', label: 'Partly', hint: 'Missed important points' },
  { r: 'good', label: 'Good', hint: 'Main points covered' },
  { r: 'easy', label: 'Excellent', hint: 'Complete, confident, with example' },
];

/**
 * Question practice: Question → Think → Answer → Self-evaluate → Reference answer → Confidence
 * → save attempt + next revision (one Firestore batch) → Continue.
 * Sources: ?source=plan | revision | weak | new | bookmarks&tag=… | ids=a,b,c | q=<id>
 */
@Component({
  selector: 'app-practice',
  host: { '(document:keydown)': 'onKey($event)' },
  imports: [FormsModule, RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    @if (loading()) { <app-loading text="Preparing your questions…" /> }
    @else if (loadError()) { <app-error [message]="loadError()" (retry)="init()" /> }
    @else if (!queue().length) {
      <app-empty [title]="emptyTitle()" [text]="emptyText()">
        <a class="btn primary" routerLink="/app/today">Back to Today</a><a class="btn" routerLink="/app/questions">Browse questions</a>
      </app-empty>
    } @else if (stage() === 'finished') {
      <div class="card stack center">
        <span class="eyebrow">Session complete</span>
        <h1>{{ results().length }} question{{ results().length === 1 ? '' : 's' }} done</h1>
        <p class="muted">Average score {{ avg() }} · {{ minutes() }} min</p>
        <div class="stack" style="text-align:left">
          @for (r of results(); track $index) {
            <div class="list-item"><span class="grow small">{{ r.q.question }}</span><app-status [status]="r.status" /><span class="xs muted nowrap">next {{ r.next }}</span></div>
          }
        </div>
        @if (nextStep(); as n) { <a class="btn primary big block" [routerLink]="n.link" [queryParams]="n.params">Next: {{ n.label }} →</a> }
        <a class="btn block" routerLink="/app/today">Back to Today</a>
      </div>
    } @else if (current(); as q) {
      <div class="row between small"><span class="muted">Question {{ index() + 1 }} of {{ queue().length }}</span>
        <span class="row"><span class="muted nowrap">⏱ {{ elapsedLabel() }}</span><button class="btn ghost sm" (click)="finish()">End session</button></span></div>
      <app-bar [value]="(index() / queue().length) * 100" />
      @if (lastSaved(); as ls) { <div class="banner good small" role="status">✓ Saved · {{ ls.status }} · next revision {{ ls.dueDate }} ({{ ls.intervalDays }} day{{ ls.intervalDays === 1 ? '' : 's' }})</div> }
      <article class="card stack">
        <div class="row"><span class="badge">{{ cats.name(q.categoryId) }}</span><span class="badge">{{ topics.name(q.topicId) }}</span><span class="badge">{{ q.difficulty }}</span><app-status [status]="status(q)" /></div>
        <h2 style="font-size:1.2rem">{{ q.question }}</h2>

        @switch (stage()) {
          @case ('question') {
            <p class="small muted">Think first: definition, how it works, one example from your project. Then answer.</p>
            <div class="grid two">
              <button class="btn primary big" (click)="stage.set('answer')">Answer (type or speak)</button>
              <button class="btn big" (click)="answerInHead()">I answered in my head</button>
            </div>
            <button class="btn ghost block" (click)="learnFirst()">I don't know it yet — learn first</button>
            <p class="xs muted center desk-only" style="margin:0">Keys: A answer · H in my head · L learn first</p>
          }
          @case ('learn') {
            <div class="banner info small">Read it, say it once in your own words, then answer from memory. It will come back tomorrow for a real check.</div>
            @if (q.keyPoints.length) { <div class="card slim" style="background:var(--surface-2)"><b class="small">Remember these points</b>
              <ol class="small" style="margin:6px 0 0;padding-left:20px">@for (k of q.keyPoints; track $index) { <li>{{ k }}</li> }</ol></div> }
            @if (q.answer) { <div class="answer small">{{ q.answer }}</div> } @else { <p class="small muted">No model answer stored for this question.</p> }
            @if (q.explanation) { <p class="small muted">{{ q.explanation }}</p> }
            <div class="grid two">
              <button class="btn primary big" (click)="afterLearn()">Got it — now answer from memory</button>
              <button class="btn big" (click)="learnOnly(q)">Learned — check it tomorrow</button>
            </div>
          }
          @case ('answer') {
            @if (learned) { <div class="banner info small">Answer from memory — the reference is hidden now.</div> }
            <div class="field"><label for="ans">Your answer</label>
              <textarea id="ans" class="input" rows="7" [(ngModel)]="answer" placeholder="Type your answer, or use the microphone"></textarea></div>
            @if (listen(); as l) {
              <div class="row small"><span class="mic-dot"></span><span class="muted">Listening… {{ l.interim() }}</span></div>
              @if (l.error()) { <div class="banner warn small">{{ l.error() }}</div> }
            }
            <div class="row">
              @if (voice.sttSupported) {
                @if (!listen()) { <button class="btn" (click)="startMic()">🎙 Speak</button> } @else { <button class="btn danger" (click)="stopMic()">■ Stop</button> }
              } @else { <span class="xs muted">Speech input isn't supported in this browser — type instead.</span> }
              <button class="btn primary grow" (click)="submitAnswer()" [disabled]="!!listen()">Done — evaluate</button>
            </div>
          }
          @case ('self') {
            <p class="label">Before seeing the answer: how did you do?</p>
            @if (learned) { <p class="xs muted" style="margin:0">You learned it just now, so today's rating counts as at most "Partly" — the real test is tomorrow.</p> }
            <div class="grid two">
              @for (r of ratings; track r.r) { <button class="btn" [class.primary]="rating() === r.r" (click)="pickRating(r.r)"><span>{{ r.label }}<br /><span class="xs muted">{{ r.hint }}</span></span></button> }
            </div>
          }
          @case ('reference') {
            @if (evaluating()) { <div class="row small"><div class="spinner"></div>Checking your answer…</div> }
            @if (evaluation(); as ev) {
              <div class="banner {{ ev.score >= 70 ? 'good' : ev.score >= 45 ? 'warn' : 'bad' }} small">
                <b>{{ ev.provider === 'none' ? 'Key-point check' : 'AI score' }}: {{ ev.score }}/100</b>
                @for (f of ev.feedback; track $index) { <div>• {{ f }}</div> }
                @if (ev.missed.length) { <div><b>Missed:</b> {{ ev.missed.join('; ') }}</div> }
              </div>
            }
            <details open><summary class="label" style="cursor:pointer">Reference answer</summary>
              @if (q.answer) { <div class="answer small" style="margin-top:8px">{{ q.answer }}</div> } @else { <p class="small muted">No model answer stored for this question.</p> }
              @if (q.explanation) { <p class="small muted" style="margin-top:8px">{{ q.explanation }}</p> }
            </details>
            @if (q.followUps.length) { <div class="small"><b>Possible follow-ups:</b> {{ q.followUps.join(' · ') }}</div> }
            <div class="field"><span class="label">Adjust your rating after comparing</span>
              <div class="row">@for (r of ratings; track r.r) { <button class="chip" [class.on]="rating() === r.r" (click)="rating.set(r.r)">{{ r.label }}</button> }</div></div>
            <div class="field"><span class="label">Confidence</span>
              <div class="row">@for (c of [1, 2, 3, 4, 5]; track c) { <button class="chip" [class.on]="confidence() === c" (click)="confidence.set(c)" [attr.aria-label]="'Confidence ' + c">{{ c }}</button> }<span class="xs muted">1 = guessing · 5 = could teach it</span></div></div>
            <div class="row">
              @for (t of tags; track t) { <button class="chip" [class.on]="bookmarks.tags(q.id).includes(t)" (click)="toggleTag(q.id, t)">{{ t }}</button> }
            </div>
            <details><summary class="small" style="cursor:pointer">Add a note</summary>
              <textarea class="input" rows="3" [(ngModel)]="note" placeholder="Your own summary or a project example"></textarea>
              <button class="btn sm" style="margin-top:6px" (click)="saveNote(q)" [disabled]="!note.trim()">Save note</button>
            </details>
            <button class="btn primary big block" (click)="save(q)" [disabled]="saving() || !rating() || !confidence()">{{ saving() ? 'Saving…' : index() + 1 < queue().length ? 'Save & next →' : 'Save & finish' }}</button>
            @if (saveError()) { <div class="banner bad small" role="alert">{{ saveError() }} <button class="btn sm" (click)="save(q)">Retry</button></div> }
          }
        }
      </article>
    }
  </div>`,
})
export class PracticeComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private md = inject(MasterDataStore);
  cats = inject(CategoryService);
  topics = inject(TopicService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  bookmarks = inject(BookmarkService);
  private notes = inject(NoteService);
  private plan = inject(DailyPlanService);
  private sessions = inject(StudySessionService);
  private ai = inject(AIInterviewService);
  private user = inject(UserService);
  private clock = inject(ClockService);
  private toast = inject(ToastService);
  private progress = inject(ProgressService);
  voice = inject(VoiceService);

  ratings = RATINGS;
  tags = BOOKMARK_TAGS;
  loading = signal(true);
  loadError = signal('');
  queue = signal<Question[]>([]);
  index = signal(0);
  stage = signal<Stage>('question');
  rating = signal<Rating | null>(null);
  confidence = signal<number | null>(null);
  evaluation = signal<Evaluation | null>(null);
  evaluating = signal(false);
  saving = signal(false);
  saveError = signal('');
  lastSaved = signal<RevisionSchedule | null>(null);
  listen = signal<ListenSession | null>(null);
  results = signal<{ q: Question; score: number; status: SrsStatus; next: string }[]>([]);
  answer = '';
  note = '';
  learned = false;
  private spokenSec = 0;
  private qStart = Date.now();
  private sessionStart = Date.now();
  private tick = signal(Date.now());
  private timer = setInterval(() => this.tick.set(Date.now()), 1000);
  private source = 'plan';

  current = computed(() => this.queue()[this.index()] ?? null);
  elapsedLabel = computed(() => { const s = Math.floor((this.tick() - this.qStart) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; });
  avg = computed(() => { const r = this.results(); return r.length ? Math.round(r.reduce((n, x) => n + x.score, 0) / r.length) : 0; });
  minutes = computed(() => Math.max(1, Math.round((this.tick() - this.sessionStart) / 60000)));
  emptyTitle = computed(() => (this.md.questions().length ? (this.source === 'revision' ? 'No revision due' : this.source === 'weak' ? 'No weak questions' : 'Nothing to practise here') : 'No questions yet'));
  emptyText = computed(() => (this.md.questions().length ? (this.source === 'revision' ? 'Everything is scheduled for later. Practise new questions or come back tomorrow.' : 'All question items in this set are done.') : 'The question bank is empty. An admin needs to import questions (Admin → Questions → Import).'));
  nextStep = computed(() => {
    if (this.source !== 'plan') return null;
    const n = this.plan.progress().next;
    if (!n) return { label: 'See progress', link: '/app/progress', params: {} };
    if (n.type === 'communication') return { label: 'Communication drill', link: '/app/communication', params: { plan: 1 } };
    if (n.type === 'voice') return { label: 'Voice interview', link: '/app/voice', params: { plan: 1, mode: 'quick' } };
    if (n.type === 'mock') return { label: 'Mock interview', link: '/app/mock-interview', params: {} };
    return { label: 'More questions', link: '/app/practice', params: { source: 'plan' } };
  });

  ngOnInit() {
    this.route.queryParamMap.subscribe(() => this.init());
  }
  ngOnDestroy() {
    clearInterval(this.timer);
    this.listen()?.stop();
    this.sessions.end().catch(() => undefined);
  }

  async init() {
    this.loading.set(true);
    this.loadError.set('');
    try {
      await Promise.all([this.md.ensureLoaded(), this.revision.ensureLoaded(), this.attempts.ensureLoaded(), this.bookmarks.ensureLoaded()]);
      const q = this.route.snapshot.queryParamMap;
      this.source = q.get('source') || (q.get('ids') || q.get('q') ? 'ids' : 'plan');
      if (this.source === 'plan') await this.plan.ensureToday();
      this.queue.set(this.build(this.source, q.get('ids') || q.get('q') || '', q.get('tag') as BookmarkTag | null));
      this.index.set(0);
      this.results.set([]);
      this.lastSaved.set(null);
      this.reset();
      this.sessionStart = Date.now();
      if (this.queue().length) {
        this.sessions.begin(this.source === 'plan' ? 'plan' : this.source === 'revision' ? 'revision' : 'practice');
        if (this.source === 'plan') this.plan.start().catch(() => undefined);
      }
    } catch (e) {
      this.loadError.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private build(source: string, ids: string, tag: BookmarkTag | null): Question[] {
    const byId = (id: string) => this.md.questionMap().get(id);
    const live = (q?: Question): q is Question => !!q && !q.isArchived && q.isActive !== false;
    switch (source) {
      case 'plan':
        return (this.plan.plan()?.items || []).filter(i => !i.done && ['revision', 'weak', 'new'].includes(i.type) && i.refId).map(i => byId(i.refId!)).filter(live);
      case 'revision':
        return this.revision.due().map(s => byId(s.questionId)).filter(live).slice(0, 30);
      case 'weak':
        return this.revision.items().filter(s => s.status === 'Weak').sort((a, b) => b.lapses - a.lapses).map(s => byId(s.questionId)).filter(live).slice(0, 20);
      case 'new': {
        const seen = this.revision.map();
        return this.md.questions().filter(q => !seen.has(q.id)).sort((a, b) => a.priority - b.priority).slice(0, 10);
      }
      case 'warmup': {
        const tomorrow = this.bookmarks.withTag('Interview Tomorrow').map(byId).filter(live);
        const strong = this.revision.items().filter(s => s.status === 'Strong' || s.status === 'Mastered').map(s => byId(s.questionId)).filter(live);
        return [...new Set([...tomorrow, ...this.revision.due().map(s => byId(s.questionId)).filter(live), ...strong])].slice(0, 5);
      }
      case 'bookmarks':
        return (tag ? this.bookmarks.withTag(tag) : this.bookmarks.items().map(b => b.questionId || b.id)).map(byId).filter(live);
      default:
        return ids.split(',').map(s => byId(s.trim())).filter(live);
    }
  }

  status(q: Question): SrsStatus { return this.revision.status(q.id); }

  private reset() {
    this.stage.set('question');
    this.rating.set(null);
    this.confidence.set(null);
    this.evaluation.set(null);
    this.saveError.set('');
    this.learned = false;
    this.answer = '';
    this.note = '';
    this.spokenSec = 0;
    this.qStart = Date.now();
  }

  /** "I don't know it yet": study the answer first, then recall it (rating capped at Partly). */
  learnFirst() {
    this.learned = true;
    this.stage.set('learn');
  }
  afterLearn() {
    this.answer = '';
    this.stage.set('answer');
  }
  /** Just learned, no recall now: schedule it for tomorrow as a new learning item. */
  async learnOnly(q: Question) {
    this.rating.set('hard');
    this.confidence.set(2);
    await this.save(q);
  }
  /** Desktop shortcuts. Ignored while typing. */
  onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT') || e.ctrlKey || e.metaKey || e.altKey) return;
    const q = this.current();
    if (!q) return;
    const k = e.key.toLowerCase();
    switch (this.stage()) {
      case 'question':
        if (k === 'a') this.stage.set('answer');
        else if (k === 'h') this.answerInHead();
        else if (k === 'l') this.learnFirst();
        else return;
        break;
      case 'self':
        if ('1234'.includes(k)) this.pickRating(this.ratings[+k - 1].r); else return;
        break;
      case 'reference':
        if ('12345'.includes(k)) this.confidence.set(+k);
        else if (k === 'enter' && this.rating() && this.confidence() && !this.saving()) this.save(q);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  }
  answerInHead() {
    this.answer = '';
    this.stage.set('self');
  }
  startMic() {
    this.listen.set(this.voice.listen());
  }
  async stopMic() {
    const l = this.listen();
    if (!l) return;
    const r = await l.stop();
    this.listen.set(null);
    this.spokenSec += r.durationSec;
    this.answer = (this.answer + ' ' + r.text).trim();
  }
  async submitAnswer() {
    if (this.listen()) await this.stopMic();
    this.stage.set('self');
  }
  async pickRating(r: Rating) {
    this.rating.set(r);
    this.stage.set('reference');
    const q = this.current();
    if (q && this.answer.trim().split(/\s+/).length >= 5) {
      this.evaluating.set(true);
      const p = this.user.profile();
      this.evaluation.set(await this.ai.evaluate(q, this.answer, this.spokenSec, { role: p?.targetRole, years: p?.yearsExperience }));
      this.evaluating.set(false);
    }
  }
  async toggleTag(qid: string, t: BookmarkTag) {
    try {
      await this.bookmarks.toggle(qid, t);
      const q = this.current();
      if (t === 'Need Revision' && q && this.bookmarks.tags(qid).includes(t)) await this.revision.scheduleSoon(q);
    } catch (e) { this.toast.bad(errorMessage(e)); }
  }
  async saveNote(q: Question) {
    try {
      await this.notes.save({ refType: 'question', refId: q.id, questionId: q.id, title: q.question.slice(0, 80), body: this.note.trim(), tags: [] });
      this.note = '';
      this.toast.good('Note saved');
    } catch (e) { this.toast.bad(errorMessage(e)); }
  }

  async save(q: Question) {
    const rating = this.rating(), confidence = this.confidence();
    if (!rating || !confidence) return;
    this.saving.set(true);
    this.saveError.set('');
    const ev = this.evaluation();
    const capped = this.learned && (rating === 'good' || rating === 'easy') ? 'hard' : rating;
    // self-rating is the source of truth for scheduling; the checked score refines the stored score
    const score = Math.min(this.learned ? 50 : 100, ev ? Math.round(RATING_SCORE[capped] * 0.5 + ev.score * 0.5) : RATING_SCORE[capped]);
    try {
      const { schedule } = await this.attempts.record(q, {
        mode: this.answer ? (this.spokenSec ? 'voice' : 'type') : 'recall', rating: capped, score, confidence,
        durationSec: Math.round((Date.now() - this.qStart) / 1000), answerText: this.answer || undefined,
      });
      this.sessions.countQuestion();
      this.lastSaved.set(schedule);
      this.results.update(r => [...r, { q, score, status: this.revision.status(q.id), next: schedule.dueDate }]);
      await this.plan.completeMatching('question', q.id).catch(() => undefined);
      this.next();
    } catch (e) {
      this.saveError.set('Could not save this attempt: ' + errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  next() {
    if (this.index() + 1 >= this.queue().length) { this.finish(); return; }
    this.index.set(this.index() + 1);
    this.reset();
  }
  async finish() {
    this.listen()?.stop();
    this.listen.set(null);
    this.stage.set('finished');
    await this.sessions.end().catch(() => undefined);
    const fresh = await this.progress.checkAchievements().catch(() => []);
    fresh.forEach(a => this.toast.good('Achievement: ' + a.title));
    if (!this.results().length) this.router.navigateByUrl('/app/today');
  }
}
