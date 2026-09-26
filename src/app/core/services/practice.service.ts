import { computed, inject, Injectable } from '@angular/core';
import { SERVER_TIME } from '../data/store';
import { review, statusOf, isDue, revisionOrder } from '../logic/srs';
import { Attempt, Bookmark, BookmarkTag, Note, PracticeMode, Question, Rating, RevisionSchedule, SrsStatus } from '../models';
import { addDays, clean } from '../util';
import { UserCollection } from './collection';
import { ClockService } from './platform.service';
import { AppConfigService } from './app-config.service';

/** users/{uid}/revisionSchedules/{questionId} */
@Injectable({ providedIn: 'root' })
export class RevisionService extends UserCollection<RevisionSchedule> {
  private clock = inject(ClockService);
  constructor() { super('revisionSchedules'); }
  readonly map = computed(() => new Map(this.items().map(s => [s.questionId || s.id, s])));
  status(questionId: string): SrsStatus {
    return statusOf(this.map().get(questionId), this.clock.today());
  }
  due(): RevisionSchedule[] {
    const t = this.clock.today();
    return this.items().filter(s => isDue(s, t)).sort(revisionOrder);
  }
  counts(): Record<SrsStatus, number> {
    const t = this.clock.today();
    const c = { New: 0, Learning: 0, Weak: 0, Due: 0, Overdue: 0, Strong: 0, Mastered: 0 } as Record<SrsStatus, number>;
    for (const s of this.items()) c[statusOf(s, t)]++;
    return c;
  }
  private config = inject(AppConfigService);
  next(q: Question, rating: Rating, confidence?: number): RevisionSchedule {
    return review(this.map().get(q.id) ?? null, { questionId: q.id, categoryId: q.categoryId, topicId: q.topicId }, rating, this.clock.today(), confidence, this.config.config().ladder);
  }
  /** Put a question back into tomorrow's revision (e.g. "Need revision" bookmark). */
  async scheduleSoon(q: Question) {
    const prev = this.map().get(q.id);
    const s: RevisionSchedule = prev ? { ...prev, dueDate: this.clock.today() } : { questionId: q.id, categoryId: q.categoryId, topicId: q.topicId, step: -1, intervalDays: 0, dueDate: this.clock.today(), reps: 0, lapses: 0, streak: 0, correct: 0, incorrect: 0, status: 'Learning' };
    await this.save(s, q.id);
  }
  async reset(questionId: string) {
    await this.remove(questionId);
  }
  /** Local cache update after AttemptService's batched write. */
  applyLocal(s: RevisionSchedule) {
    this.upsertLocal({ ...s, id: s.questionId, updatedAt: Date.now() });
  }
}

/** users/{uid}/attempts — last 12 months are loaded; older history stays in Firestore. */
@Injectable({ providedIn: 'root' })
export class AttemptService extends UserCollection<Attempt> {
  private clock = inject(ClockService);
  private revision = inject(RevisionService);
  constructor() { super('attempts', { where: [['date', '>=', addDays(new Date().toISOString().slice(0, 10), -366)]], orderBy: [['date', 'desc']], limit: 5000 }); }

  forQuestion(qid: string) {
    return this.items().filter(a => a.questionId === qid).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  todayCount() {
    const t = this.clock.today();
    return this.items().filter(a => a.date === t).length;
  }

  /**
   * Records an attempt and updates the question's revision schedule atomically (one batch).
   */
  async record(q: Question, p: { mode: PracticeMode; rating: Rating; score: number; confidence: number; durationSec: number; answerText?: string }) {
    await this.ensureLoaded();
    await this.revision.ensureLoaded();
    const uid = this.uid;
    const today = this.clock.today();
    const id = this.store.newId(this.coll());
    const attempt: Attempt = clean({
      questionId: q.id, categoryId: q.categoryId, topicId: q.topicId, mode: p.mode, rating: p.rating,
      score: Math.round(p.score), confidence: p.confidence, durationSec: Math.round(p.durationSec),
      answerText: p.answerText ? p.answerText.slice(0, 5000) : undefined, date: today,
    });
    const sched = this.revision.next(q, p.rating, p.confidence);
    await this.store.batch([
      { type: 'set', path: `users/${uid}/attempts/${id}`, data: { ...attempt, createdAt: SERVER_TIME } },
      { type: 'set', path: `users/${uid}/revisionSchedules/${q.id}`, data: clean({ ...sched, updatedAt: SERVER_TIME }) },
    ]);
    this.upsertLocal({ ...attempt, id, createdAt: Date.now() });
    this.revision.applyLocal(sched);
    return { attempt: { ...attempt, id }, schedule: sched };
  }
}

/** users/{uid}/bookmarks/{questionId} */
@Injectable({ providedIn: 'root' })
export class BookmarkService extends UserCollection<Bookmark> {
  constructor() { super('bookmarks'); }
  readonly map = computed(() => new Map(this.items().map(b => [b.questionId || b.id, b])));
  tags(qid: string): BookmarkTag[] {
    return this.map().get(qid)?.tags ?? [];
  }
  withTag(tag: BookmarkTag): string[] {
    return this.items().filter(b => b.tags.includes(tag)).map(b => b.questionId || b.id);
  }
  async toggle(qid: string, tag: BookmarkTag) {
    const cur = this.tags(qid);
    const next = cur.includes(tag) ? cur.filter(t => t !== tag) : [...cur, tag];
    if (!next.length) return this.remove(qid);
    await this.save({ questionId: qid, tags: next }, qid);
  }
}

/** users/{uid}/notes */
@Injectable({ providedIn: 'root' })
export class NoteService extends UserCollection<Note> {
  constructor() { super('notes', { orderBy: [['updatedAt', 'desc']], limit: 1000 }); }
  forQuestion(qid: string) {
    return this.items().filter(n => n.questionId === qid);
  }
}
