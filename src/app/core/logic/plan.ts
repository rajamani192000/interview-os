import { DailyPlan, PlanItem, Question, RevisionSchedule } from '../models';
import { daysBetween } from '../util';
import { isDue, revisionOrder } from './srs';

export const ITEM_MINUTES = { revision: 3, weak: 4, new: 5, communication: 5, voice: 8, mock: 20, 'job-prep': 10 } as const;
export const RECOVERY_SHAPE = { revision: 3, weak: 2, communication: 1, voice: 1 };
/** Recovery is sized to a 15-minute restart: 3×2 + 2×2 + 2 + 3. */
export const RECOVERY_MINUTES = { revision: 2, weak: 2, communication: 2, voice: 3, new: 2, mock: 0, 'job-prep': 0 } as const;

export interface PlanInput {
  today: string;
  dailyMinutes: number;
  newPerDay: number;
  voiceEnabled: boolean;
  questions: Question[]; // active master questions
  schedules: RevisionSchedule[];
  weakQuestionIds: string[]; // from weak-area analysis, ordered weakest first
  focusCategoryIds: string[];
  interviewDate?: string;
  interviewTomorrowIds?: string[]; // bookmarked "Interview Tomorrow"
  lastStudyDay?: string; // last day with any completed plan item / attempt
  studyDays?: number[]; // 0..6, days the user plans to study
}

/** Counts planned study days missed between lastStudyDay and today (exclusive). */
export function missedStudyDays(lastStudyDay: string | undefined, today: string, studyDays: number[] = [0, 1, 2, 3, 4, 5, 6]): number {
  if (!lastStudyDay) return 0;
  const gap = daysBetween(lastStudyDay, today);
  let missed = 0;
  for (let i = 1; i < gap; i++) {
    const [y, m, d] = lastStudyDay.split('-').map(Number);
    const dow = new Date(y, m - 1, d + i).getDay();
    if (studyDays.includes(dow)) missed++;
  }
  return missed;
}

export function planMode(input: PlanInput): DailyPlan['mode'] {
  if (input.interviewDate) {
    const d = daysBetween(input.today, input.interviewDate);
    if (d >= 0 && d <= 3) return 'interview';
  }
  return missedStudyDays(input.lastStudyDay, input.today, input.studyDays) >= 2 ? 'recovery' : 'normal';
}

export function buildPlan(input: PlanInput): DailyPlan {
  const qById = new Map(input.questions.map(q => [q.id, q]));
  const title = (id: string) => qById.get(id)?.question || 'Question';
  const due = input.schedules.filter(s => qById.has(s.questionId) && isDue(s, input.today)).sort(revisionOrder);
  const scheduled = new Set(input.schedules.map(s => s.questionId));
  const used = new Set<string>();
  const items: PlanItem[] = [];
  const mode = planMode(input);
  const push = (type: PlanItem['type'], refId: string | undefined, t: string) => {
    if (refId) used.add(refId);
    items.push({ id: `${type}-${refId || items.length}`, type, refId, title: t, minutes: mode === 'recovery' ? RECOVERY_MINUTES[type] : ITEM_MINUTES[type], done: false });
  };
  const weak = input.weakQuestionIds.filter(id => qById.has(id));

  /**
   * New questions: focus categories first, then by priority/difficulty, interleaved across categories
   * so one day isn't all SQL (mixing topics improves retention).
   */
  const newQs = () => {
    const sorted = input.questions
      .filter(q => !scheduled.has(q.id) && !used.has(q.id))
      .sort((a, b) => {
        const d = (q: Question) => ['Easy', 'Medium', 'Hard', 'Senior'].indexOf(q.difficulty);
        return a.priority - b.priority || d(a) - d(b) || a.id.localeCompare(b.id);
      });
    const byCat = new Map<string, Question[]>();
    for (const q of sorted) (byCat.get(q.categoryId) ?? byCat.set(q.categoryId, []).get(q.categoryId)!).push(q);
    const focus = input.focusCategoryIds.filter(c => byCat.has(c));
    const order = [...focus, ...[...byCat.keys()].filter(c => !focus.includes(c)).sort((a, b) => byCat.get(a)![0].priority - byCat.get(b)![0].priority || a.localeCompare(b))];
    const out: Question[] = [];
    for (let i = 0; out.length < sorted.length; i++) for (const c of order) { const q = byCat.get(c)![i]; if (q) out.push(q); }
    return out;
  };

  if (mode === 'recovery') {
    due.slice(0, RECOVERY_SHAPE.revision).forEach(s => push('revision', s.questionId, title(s.questionId)));
    weak.filter(id => !used.has(id)).slice(0, RECOVERY_SHAPE.weak).forEach(id => push('weak', id, title(id)));
    // not enough history yet: top up with new questions so the restart is still 3 + 2
    const short = RECOVERY_SHAPE.revision + RECOVERY_SHAPE.weak - items.length;
    newQs().slice(0, Math.max(0, short)).forEach(q => push('new', q.id, q.question));
    push('communication', undefined, 'Speak for 2 minutes: introduce yourself');
    if (input.voiceEnabled) push('voice', undefined, 'Quick voice interview: 3 questions');
    return finalize(input.today, mode, items);
  }

  if (mode === 'interview') {
    (input.interviewTomorrowIds || []).filter(id => qById.has(id)).slice(0, 6).forEach(id => push('revision', id, title(id)));
    due.filter(s => !used.has(s.questionId)).slice(0, 5).forEach(s => push('revision', s.questionId, title(s.questionId)));
    weak.filter(id => !used.has(id)).slice(0, 3).forEach(id => push('weak', id, title(id)));
    push('communication', undefined, 'Rehearse your self introduction out loud');
    if (input.voiceEnabled) push('voice', undefined, 'Mock voice round on your weakest topics');
    return finalize(input.today, mode, items);
  }

  // normal
  const budget = Math.max(15, input.dailyMinutes);
  const fixed = ITEM_MINUTES.communication + (input.voiceEnabled ? ITEM_MINUTES.voice : 0);
  let left = budget - fixed;
  const revCap = Math.max(3, Math.floor((left * 0.5) / ITEM_MINUTES.revision));
  for (const s of due.slice(0, revCap)) {
    if (left < ITEM_MINUTES.revision) break;
    push('revision', s.questionId, title(s.questionId));
    left -= ITEM_MINUTES.revision;
  }
  for (const id of weak.filter(id => !used.has(id)).slice(0, 3)) {
    if (left < ITEM_MINUTES.weak) break;
    push('weak', id, title(id));
    left -= ITEM_MINUTES.weak;
  }
  let added = 0;
  for (const q of newQs()) {
    if (added >= input.newPerDay || left < ITEM_MINUTES.new) break;
    push('new', q.id, q.question);
    left -= ITEM_MINUTES.new;
    added++;
  }
  push('communication', undefined, 'Speaking drill (2–3 minutes)');
  if (input.voiceEnabled) push('voice', undefined, 'Voice interview: 3 questions');
  return finalize(input.today, mode, items);
}

function finalize(date: string, mode: DailyPlan['mode'], items: PlanItem[]): DailyPlan {
  return { date, mode, items, minutesPlanned: items.reduce((n, i) => n + i.minutes, 0) };
}

export function planProgress(p: DailyPlan | null | undefined) {
  if (!p || !p.items.length) return { done: 0, total: 0, pct: 0, minutesDone: 0, complete: false, next: undefined as PlanItem | undefined };
  const done = p.items.filter(i => i.done).length;
  return {
    done,
    total: p.items.length,
    pct: Math.round((done / p.items.length) * 100),
    minutesDone: p.items.filter(i => i.done).reduce((n, i) => n + i.minutes, 0),
    complete: done === p.items.length,
    next: p.items.find(i => !i.done),
  };
}
