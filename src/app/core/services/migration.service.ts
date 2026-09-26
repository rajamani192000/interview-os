import { inject, Injectable } from '@angular/core';
import { BatchOp, DATA_STORE, SERVER_TIME } from '../data/store';
import { isOldState, migrate, MigrationResult, OldState } from '../logic/migrate';
import { extractSkills } from '../logic/jd';
import { clean } from '../util';
import { AuthService } from './auth.service';
import { InterviewService, JobService } from './career.service';
import { MasterDataStore } from './master-data.service';
import { DailyPlanService } from './plan.service';
import { ClockService } from './platform.service';
import { AttemptService, BookmarkService, NoteService, RevisionService } from './practice.service';

/** Moves progress from the previous Interview Coach app into Firestore (users/{uid}/...). */
@Injectable({ providedIn: 'root' })
export class MigrationService {
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  private md = inject(MasterDataStore);
  private clock = inject(ClockService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private bookmarks = inject(BookmarkService);
  private notes = inject(NoteService);
  private jobs = inject(JobService);
  private interviews = inject(InterviewService);
  private plan = inject(DailyPlanService);

  /** Reads the old app's cloud copy (users/{uid} + users/{uid}/chunks/c0..n) if this account has one. */
  async readCloudCopy(): Promise<OldState | null> {
    const uid = this.auth.uid()!;
    const meta = await this.store.get<{ n?: number }>(`users/${uid}`);
    const n = Number(meta?.n || 0);
    if (!n) return null;
    let text = '';
    for (let i = 0; i < n; i++) {
      const c = await this.store.get<{ s?: string }>(`users/${uid}/chunks/c${i}`);
      if (!c?.s) return null;
      text += c.s;
    }
    const st = JSON.parse(text);
    return isOldState(st) ? st : null;
  }

  parseBackup(text: string): OldState {
    const st = JSON.parse(text);
    if (!isOldState(st)) throw new Error('This file is not an Interview Coach backup.');
    return st;
  }

  async preview(old: OldState): Promise<MigrationResult> {
    await this.md.ensureLoaded();
    return migrate(old, this.md.allQuestions(), this.clock.today());
  }

  /** Writes the migrated data. Existing schedules are kept when they have more reviews. */
  async apply(r: MigrationResult): Promise<void> {
    const uid = this.auth.uid()!;
    await Promise.all([this.revision.ensureLoaded(), this.bookmarks.ensureLoaded(), this.jobs.ensureLoaded()]);
    const ops: BatchOp[] = [];
    for (const s of r.schedules) {
      const cur = this.revision.map().get(s.questionId);
      if (cur && cur.reps >= s.reps) continue;
      ops.push({ type: 'set', path: `users/${uid}/revisionSchedules/${s.questionId}`, data: clean({ ...s, updatedAt: SERVER_TIME }) });
    }
    for (const a of r.attempts) ops.push({ type: 'set', path: `users/${uid}/attempts/${this.store.newId(`users/${uid}/attempts`)}`, data: clean({ ...a, createdAt: SERVER_TIME }) });
    for (const b of r.bookmarks) {
      const tags = [...new Set([...this.bookmarks.tags(b.questionId), ...b.tags])];
      ops.push({ type: 'set', path: `users/${uid}/bookmarks/${b.questionId}`, data: { questionId: b.questionId, tags, updatedAt: SERVER_TIME } });
    }
    for (const n of r.notes) ops.push({ type: 'set', path: `users/${uid}/notes/${this.store.newId(`users/${uid}/notes`)}`, data: clean({ ...n, createdAt: SERVER_TIME, updatedAt: SERVER_TIME }) });
    for (const j of r.jobs) {
      if (this.jobs.duplicateOf(j)) continue;
      ops.push({ type: 'set', path: `users/${uid}/jobs/${this.store.newId(`users/${uid}/jobs`)}`, data: clean({ ...j, skills: extractSkills(j.jd), createdAt: SERVER_TIME, updatedAt: SERVER_TIME }) });
    }
    for (let i = 0; i < ops.length; i += 400) await this.store.batch(ops.slice(i, i + 400));
    await Promise.all([this.revision.ensureLoaded(true), this.attempts.ensureLoaded(true), this.bookmarks.ensureLoaded(true), this.notes.ensureLoaded(true), this.jobs.ensureLoaded(true), this.interviews.ensureLoaded(true)]);
    await this.plan.regenerate().catch(() => undefined);
  }
}
