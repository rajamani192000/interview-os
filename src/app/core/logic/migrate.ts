import { Attempt, Bookmark, BookmarkTag, Job, JOB_STATUSES, JobStatus, Note, Question, Rating, RevisionSchedule } from '../models';
import { hashText } from '../util';
import { LADDER, RATING_SCORE, storedStatus } from './srs';

/**
 * Converts data from the previous "Interview Coach" app (backup JSON, or its cloud copy in
 * users/{uid}/chunks) into Interview OS documents. Questions are matched by the id they had in the
 * imported bank (sourceId, e.g. "c01") or by identical wording. Nothing is invented: only recorded
 * attempts, schedules, flags, notes and jobs are carried over.
 */
interface OldSrs { step?: number; due?: string | null; attempts?: number; correct?: number; incorrect?: number; lapses?: number; conf?: number; lastResult?: string | null; lastAt?: number | null; revisions?: number; }
interface OldQ { id: string; question?: string; srs?: OldSrs; flags?: Record<string, boolean>; notes?: Record<string, string>; custom?: boolean; }
interface OldAttempt { qid: string; at?: number; d?: string; result?: string; conf?: number; sec?: number; mode?: string; }
interface OldJob { company?: string; role?: string; title?: string; location?: string; url?: string; jd?: string; salaryText?: string; status?: string; notes?: string; source?: string; created?: number; }
export interface OldState { questions?: OldQ[]; attempts?: OldAttempt[]; jobs?: OldJob[]; _backup?: unknown; }

export interface MigrationResult {
  schedules: RevisionSchedule[];
  attempts: Attempt[];
  bookmarks: Bookmark[];
  notes: Note[];
  jobs: Job[];
  unmatched: number; // old questions with progress that aren't in the new bank
}

const RESULT: Record<string, Rating> = { correct: 'good', partial: 'hard', incorrect: 'again' };
const FLAG: Record<string, BookmarkTag> = { bookmark: 'Bookmark', important: 'Important', difficult: 'Difficult', tomorrow: 'Interview Tomorrow' };
const NOTE_LABEL: Record<string, string> = { remember: 'Remember', project: 'Project example', interview: 'Interview note', mistake: 'Mistake to avoid' };
const JOB_MAP: Record<string, JobStatus> = { Considering: 'Saved', 'Technical Round': 'Technical', 'Managerial Round': 'Managerial', 'HR Round': 'HR' };

export function isOldState(x: unknown): x is OldState {
  return !!x && typeof x === 'object' && Array.isArray((x as OldState).questions);
}

export function migrate(old: OldState, questions: Question[], today: string): MigrationResult {
  const bySource = new Map(questions.filter(q => q.sourceId).map(q => [q.sourceId!, q]));
  const byHash = new Map(questions.map(q => [q.hash, q]));
  const find = (o: OldQ) => bySource.get(o.id) || (o.question ? byHash.get(hashText(o.question)) : undefined);
  const idMap = new Map<string, Question>();
  const out: MigrationResult = { schedules: [], attempts: [], bookmarks: [], notes: [], jobs: [], unmatched: 0 };

  for (const o of old.questions || []) {
    const q = find(o);
    const s = o.srs || {};
    const practised = (s.attempts || 0) > 0;
    if (!q) { if (practised) out.unmatched++; continue; }
    idMap.set(o.id, q);
    if (practised) {
      const step = Math.max(0, Math.min(LADDER.length - 1, s.step ?? 0));
      const lastRating = RESULT[s.lastResult || ''] || 'hard';
      const sch: RevisionSchedule = {
        questionId: q.id, categoryId: q.categoryId, topicId: q.topicId, step, intervalDays: LADDER[step],
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(s.due || '') ? s.due! : today, reps: s.attempts || 0, lapses: s.lapses || 0,
        streak: lastRating === 'good' ? 1 : 0, correct: s.correct || 0, incorrect: s.incorrect || 0, confidence: s.conf || undefined,
        lastRating, lastReviewed: s.lastAt ? new Date(s.lastAt).toISOString().slice(0, 10) : undefined, status: 'Learning',
      };
      sch.status = storedStatus(sch);
      out.schedules.push(sch);
    }
    const tags = Object.entries(o.flags || {}).filter(([k, v]) => v && FLAG[k]).map(([k]) => FLAG[k]);
    if (tags.length) out.bookmarks.push({ questionId: q.id, tags });
    const body = Object.entries(o.notes || {}).filter(([, v]) => v && v.trim()).map(([k, v]) => `${NOTE_LABEL[k] || k}: ${v.trim()}`).join('\n\n');
    if (body) out.notes.push({ refType: 'question', refId: q.id, questionId: q.id, title: q.question.slice(0, 80), body, tags: ['imported'] });
  }

  for (const a of old.attempts || []) {
    const q = idMap.get(a.qid);
    if (!q) continue;
    const rating = RESULT[a.result || ''] || 'hard';
    const date = a.d && /^\d{4}-\d{2}-\d{2}$/.test(a.d) ? a.d : a.at ? new Date(a.at).toISOString().slice(0, 10) : today;
    out.attempts.push({ questionId: q.id, categoryId: q.categoryId, topicId: q.topicId, mode: /voice/.test(a.mode || '') ? 'voice' : /mock/.test(a.mode || '') ? 'mock' : 'recall', rating, score: RATING_SCORE[rating], confidence: Math.min(5, Math.max(1, a.conf || 3)), durationSec: Math.round(a.sec || 0), date });
  }

  for (const j of old.jobs || []) {
    if (!j.company || !(j.role || j.title)) continue;
    const st = (JOB_MAP[j.status || ''] || j.status || 'Saved') as JobStatus;
    out.jobs.push({ company: j.company, title: (j.role || j.title)!, location: j.location || '', url: j.url || '', source: j.source || 'Interview Coach', status: (JOB_STATUSES as readonly string[]).includes(st) ? st : 'Saved', salaryNote: j.salaryText || '', jd: j.jd || '', skills: [], notes: j.notes || '', archived: false });
  }
  return out;
}
