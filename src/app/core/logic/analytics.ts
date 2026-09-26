import { Attempt, CommunicationSession, DailyPlan, MockInterview, RevisionSchedule, StudySession, VoiceSession } from '../models';
import { addDays, daysBetween } from '../util';

export type Range = '7' | '30' | '90' | 'all';

export interface Analytics {
  from: string;
  attempts: number;
  questions: number;
  avgScore: number;
  minutes: number;
  activeDays: number;
  currentStreak: number;
  bestStreak: number;
  plansCompleted: number;
  voiceSessions: number;
  commSessions: number;
  mocks: number;
  avgVoice: number | null;
  avgWpm: number | null;
  fillersPerSession: number | null;
  byDay: { day: string; attempts: number; avgScore: number; minutes: number }[];
  byCategory: { categoryId: string; attempts: number; avgScore: number }[];
  statusCounts: Record<string, number>;
}

export function rangeStart(range: Range, today: string, firstDay?: string): string {
  if (range === 'all') return firstDay || addDays(today, -365);
  return addDays(today, -(Number(range) - 1));
}

/** Active day = any attempt, study session or completed plan item that day. */
export function streaks(activeDays: Set<string>, today: string): { current: number; best: number } {
  const days = [...activeDays].sort();
  let best = 0, run = 0, prev = '';
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let cursor = activeDays.has(today) ? today : addDays(today, -1); // today not yet active doesn't break the streak
  while (activeDays.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  return { current, best };
}

export function computeAnalytics(range: Range, today: string, d: { attempts: Attempt[]; sessions: StudySession[]; plans: DailyPlan[]; voice: VoiceSession[]; comm: CommunicationSession[]; mocks: MockInterview[]; schedules: RevisionSchedule[] }): Analytics {
  const first = [...d.attempts.map(a => a.date), ...d.sessions.map(s => s.date)].sort()[0];
  const from = rangeStart(range, today, first);
  const inR = (day: string) => day >= from && day <= today;
  const att = d.attempts.filter(a => inR(a.date));
  const ses = d.sessions.filter(s => inR(s.date));
  const allActive = new Set<string>([...d.attempts.map(a => a.date), ...d.sessions.map(s => s.date), ...d.plans.filter(p => p.items.some(i => i.done)).map(p => p.date)]);
  const st = streaks(allActive, today);
  const byDayMap = new Map<string, { attempts: number; sum: number; minutes: number }>();
  const span = Math.min(daysBetween(from, today) + 1, 366);
  for (let i = 0; i < span; i++) byDayMap.set(addDays(from, i), { attempts: 0, sum: 0, minutes: 0 });
  for (const a of att) { const x = byDayMap.get(a.date); if (x) { x.attempts++; x.sum += a.score; } }
  for (const s of ses) { const x = byDayMap.get(s.date); if (x) x.minutes += s.minutes; }
  const byCat = new Map<string, { n: number; sum: number }>();
  for (const a of att) { const x = byCat.get(a.categoryId) ?? { n: 0, sum: 0 }; x.n++; x.sum += a.score; byCat.set(a.categoryId, x); }
  const voice = d.voice.filter(v => inR(v.date));
  const comm = d.comm.filter(c => inR(c.date));
  const wpms = [...comm.map(c => c.metrics?.wpm), ...voice.map(v => v.metrics?.wpm)].filter((x): x is number => !!x);
  const statusCounts: Record<string, number> = {};
  for (const s of d.schedules) statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  return {
    from,
    attempts: att.length,
    questions: new Set(att.map(a => a.questionId)).size,
    avgScore: att.length ? Math.round(att.reduce((n, a) => n + a.score, 0) / att.length) : 0,
    minutes: ses.reduce((n, s) => n + s.minutes, 0),
    activeDays: [...allActive].filter(inR).length,
    currentStreak: st.current,
    bestStreak: st.best,
    plansCompleted: d.plans.filter(p => inR(p.date) && p.items.length && p.items.every(i => i.done)).length,
    voiceSessions: voice.length,
    commSessions: comm.length,
    mocks: d.mocks.filter(m => inR(m.date) && m.status === 'completed').length,
    avgVoice: voice.length ? Math.round(voice.reduce((n, v) => n + v.overall, 0) / voice.length) : null,
    avgWpm: wpms.length ? Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length) : null,
    fillersPerSession: comm.length ? +(comm.reduce((n, c) => n + (c.metrics?.fillers || 0), 0) / comm.length).toFixed(1) : null,
    byDay: [...byDayMap].map(([day, x]) => ({ day, attempts: x.attempts, avgScore: x.attempts ? Math.round(x.sum / x.attempts) : 0, minutes: x.minutes })),
    byCategory: [...byCat].map(([categoryId, x]) => ({ categoryId, attempts: x.n, avgScore: Math.round(x.sum / x.n) })).sort((a, b) => a.avgScore - b.avgScore),
    statusCounts,
  };
}
