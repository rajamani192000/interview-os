import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BOOKMARK_TAGS, BookmarkTag, DIFFICULTIES, Question, SRS_STATUSES, SrsStatus } from '../core/models';
import { AuthService } from '../core/services/auth.service';
import { CategoryService, MasterDataStore, QuestionService, TopicService } from '../core/services/master-data.service';
import { ToastService } from '../core/services/platform.service';
import { AttemptService, BookmarkService, NoteService, RevisionService } from '../core/services/practice.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

const PAGE = 25;

@Component({
  selector: 'app-questions',
  imports: [FormsModule, RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Questions" [subtitle]="md.questions().length + ' questions in your bank'">
      @if (filtered().length) { <button class="btn primary" (click)="practiseFiltered()">Practise these ({{ Math.min(filtered().length, 20) }})</button> }
    </app-page-header>
    @if (md.state() === 'loading' && !md.questions().length) { <app-loading /> }
    @else if (md.state() === 'error') { <app-error [message]="md.error()" (retry)="reload()" /> }
    @else if (!md.questions().length) {
      <app-empty title="No questions yet" text="Questions come from your own import. Nothing is generated.">
        @if (auth.isAdmin()) { <a class="btn primary" routerLink="/admin/questions" [queryParams]="{ import: 1 }">Import questions</a> }
      </app-empty>
    } @else {
      <div class="card stack">
        <input class="input" type="search" placeholder="Search question, answer or tag" [ngModel]="text()" (ngModelChange)="text.set($event); page.set(0)" aria-label="Search" />
        <div class="grid four">
          <select class="input" [ngModel]="cat()" (ngModelChange)="cat.set($event); topic.set(''); page.set(0)" aria-label="Category">
            <option value="">All categories</option>@for (c of cats.list(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
          <select class="input" [ngModel]="topic()" (ngModelChange)="topic.set($event); page.set(0)" aria-label="Topic">
            <option value="">All topics</option>@for (t of topicsFor(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }</select>
          <select class="input" [ngModel]="diff()" (ngModelChange)="diff.set($event); page.set(0)" aria-label="Difficulty">
            <option value="">Any difficulty</option>@for (d of difficulties; track d) { <option [value]="d">{{ d }}</option> }</select>
          <select class="input" [ngModel]="status()" (ngModelChange)="status.set($event); page.set(0)" aria-label="Status">
            <option value="">Any status</option>@for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select>
        </div>
        <div class="tabs">
          <button class="chip" [class.on]="!tag()" (click)="tag.set(''); page.set(0)">All</button>
          @for (t of tags; track t) { <button class="chip" [class.on]="tag() === t" (click)="tag.set(t); page.set(0)">{{ t }} ({{ bookmarks.withTag(t).length }})</button> }
        </div>
      </div>
      @if (!filtered().length) { <app-empty title="No matching questions" text="Try clearing a filter." /> }
      @else {
        <div class="card list" style="padding:4px 12px">
          @for (q of pageItems(); track q.id) {
            <a class="list-item clickable" [routerLink]="['/app/questions', q.id]" style="color:var(--text);text-decoration:none">
              <div class="grow stack" style="gap:2px"><span>{{ q.question }}</span><span class="xs muted">{{ cats.name(q.categoryId) }} · {{ topics.name(q.topicId) }} · {{ q.difficulty }}</span></div>
              <app-status [status]="revision.status(q.id)" />
            </a>
          }
        </div>
        <div class="row between small"><span class="muted">{{ page() * PAGE + 1 }}–{{ Math.min((page() + 1) * PAGE, filtered().length) }} of {{ filtered().length }}</span>
          <span class="row"><button class="btn sm" [disabled]="page() === 0" (click)="page.set(page() - 1)">Previous</button><button class="btn sm" [disabled]="(page() + 1) * PAGE >= filtered().length" (click)="page.set(page() + 1)">Next</button></span></div>
      }
    }
  </div>`,
})
export class QuestionsComponent implements OnInit {
  auth = inject(AuthService);
  md = inject(MasterDataStore);
  qs = inject(QuestionService);
  cats = inject(CategoryService);
  topics = inject(TopicService);
  revision = inject(RevisionService);
  bookmarks = inject(BookmarkService);
  private router = inject(Router);
  Math = Math;
  PAGE = PAGE;
  difficulties = DIFFICULTIES;
  statuses = SRS_STATUSES;
  tags = BOOKMARK_TAGS;
  text = signal('');
  cat = signal('');
  topic = signal('');
  diff = signal('');
  status = signal<SrsStatus | ''>('');
  tag = signal<BookmarkTag | ''>('');
  page = signal(0);
  topicsFor = computed(() => (this.cat() ? this.topics.forCategory(this.cat()) : this.topics.list()));
  filtered = computed(() => {
    const tag = this.tag();
    const ids = tag ? new Set(this.bookmarks.withTag(tag)) : undefined;
    let l = this.qs.filter({ text: this.text(), categoryId: this.cat(), topicId: this.topic(), difficulty: this.diff(), ids });
    if (this.status()) l = l.filter(q => this.revision.status(q.id) === this.status());
    return l;
  });
  pageItems = computed(() => this.filtered().slice(this.page() * PAGE, (this.page() + 1) * PAGE));

  ngOnInit() { this.reload(); }
  reload() {
    Promise.all([this.md.ensureLoaded(), this.revision.ensureLoaded(), this.bookmarks.ensureLoaded()]).catch(() => undefined);
  }
  practiseFiltered() {
    this.router.navigate(['/app/practice'], { queryParams: { ids: this.filtered().slice(0, 20).map(q => q.id).join(',') } });
  }
}

@Component({
  selector: 'app-question-detail',
  imports: [FormsModule, RouterLink, DatePipe, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    @if (md.state() !== 'ready') { <app-loading /> }
    @else if (!q()) { <app-empty title="Question not found" text="It may have been archived."><a class="btn" routerLink="/app/questions">All questions</a></app-empty> }
    @else if (q(); as q) {
      <app-page-header title="Question" back="/app/questions"><a class="btn primary" routerLink="/app/practice" [queryParams]="{ q: q.id }">Practise</a></app-page-header>
      <article class="card stack">
        <div class="row"><span class="badge">{{ cats.name(q.categoryId) }}</span><span class="badge">{{ topics.name(q.topicId) }}</span><span class="badge">{{ q.difficulty }}</span><span class="badge">{{ q.type }}</span><app-status [status]="revision.status(q.id)" /></div>
        <h2>{{ q.question }}</h2>
        <details><summary class="label" style="cursor:pointer">Show reference answer</summary><div class="answer small" style="margin-top:8px">{{ q.answer || 'No model answer stored.' }}</div>
          @if (q.explanation) { <p class="small muted">{{ q.explanation }}</p> }</details>
        @if (q.keyPoints.length) { <div class="small"><b>Key points:</b> {{ q.keyPoints.join(' · ') }}</div> }
        @if (q.followUps.length) { <div class="small"><b>Follow-ups:</b> {{ q.followUps.join(' · ') }}</div> }
        @if (q.tags.length) { <div class="row">@for (t of q.tags; track t) { <span class="badge">#{{ t }}</span> }</div> }
        <div class="row">@for (t of tags; track t) { <button class="chip" [class.on]="bookmarks.tags(q.id).includes(t)" (click)="toggle(q, t)">{{ t }}</button> }</div>
      </article>
      @if (revision.map().get(q.id); as s) {
        <section class="card grid stats">
          <div class="stat"><span class="eyebrow">Next revision</span><b style="font-size:1.1rem">{{ s.dueDate }}</b></div>
          <div class="stat"><span class="eyebrow">Correct / incorrect</span><b style="font-size:1.1rem">{{ s.correct || 0 }} / {{ s.incorrect || 0 }}</b></div>
          <div class="stat"><span class="eyebrow">Revisions</span><b style="font-size:1.1rem">{{ s.reps }}</b></div>
          <div class="stat"><span class="eyebrow">Confidence</span><b style="font-size:1.1rem">{{ s.confidence ?? '—' }}/5</b></div>
        </section>
      }
      <section class="card stack">
        <h3>Attempt history</h3>
        @for (a of history(); track a.id) { <div class="row between small"><span>{{ a.date }} · {{ a.mode }}</span><span>{{ a.rating }} · {{ a.score }} · conf {{ a.confidence }}</span></div> }
        @empty { <p class="small muted" style="margin:0">Not practised yet.</p> }
      </section>
      <section class="card stack">
        <h3>Your notes</h3>
        @for (n of notes.forQuestion(q.id); track n.id) {
          <div class="stack" style="gap:2px;border-bottom:1px solid var(--border);padding-bottom:8px"><div class="pre small">{{ n.body }}</div>
            <div class="row between xs muted"><span>{{ n.updatedAt | date: 'd MMM y' }}</span><button class="btn ghost sm" (click)="removeNote(n.id)">Delete</button></div></div>
        }
        <textarea class="input" rows="3" [(ngModel)]="noteText" placeholder="Add a note (your own example, a trick to remember)"></textarea>
        <div><button class="btn sm primary" (click)="addNote(q)" [disabled]="!noteText.trim() || saving()">Save note</button></div>
      </section>
    }
  </div>`,
})
export class QuestionDetailComponent implements OnInit {
  id = input.required<string>();
  md = inject(MasterDataStore);
  cats = inject(CategoryService);
  topics = inject(TopicService);
  revision = inject(RevisionService);
  bookmarks = inject(BookmarkService);
  notes = inject(NoteService);
  private attempts = inject(AttemptService);
  private toast = inject(ToastService);
  tags = BOOKMARK_TAGS;
  noteText = '';
  saving = signal(false);
  q = computed(() => this.md.questionMap().get(this.id()));
  history = computed(() => this.attempts.forQuestion(this.id()).slice(0, 20));

  ngOnInit() {
    Promise.all([this.md.ensureLoaded(), this.revision.ensureLoaded(), this.bookmarks.ensureLoaded(), this.notes.ensureLoaded(), this.attempts.ensureLoaded()]).catch(e => this.toast.bad(errorMessage(e)));
  }
  async toggle(q: Question, t: BookmarkTag) {
    try {
      await this.bookmarks.toggle(q.id, t);
      if (t === 'Need Revision' && this.bookmarks.tags(q.id).includes(t)) { await this.revision.scheduleSoon(q); this.toast.good('Added to today’s revision'); }
    } catch (e) { this.toast.bad(errorMessage(e)); }
  }
  async addNote(q: Question) {
    this.saving.set(true);
    try { await this.notes.save({ refType: 'question', refId: q.id, questionId: q.id, title: q.question.slice(0, 80), body: this.noteText.trim(), tags: [] }); this.noteText = ''; }
    catch (e) { this.toast.bad(errorMessage(e)); }
    finally { this.saving.set(false); }
  }
  async removeNote(id: string) {
    try { await this.notes.remove(id); } catch (e) { this.toast.bad(errorMessage(e)); }
  }
}
