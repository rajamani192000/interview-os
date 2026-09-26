import { Attempt, Category, RevisionSchedule, Topic } from '../models';

export interface WeakArea {
  key: string; // topicId or categoryId
  level: 'topic' | 'category';
  name: string;
  categoryName?: string;
  attempts: number;
  avgScore: number;
  avgConfidence: number;
  weakQuestions: number;
  lapses: number;
  severity: number; // 0..100, higher = weaker
  questionIds: string[];
}

/**
 * Aggregates weak areas from the user's real attempts and schedules only.
 * An area with no attempts is not called weak (it is "not practised yet").
 */
export function weakAreas(attempts: Attempt[], schedules: RevisionSchedule[], topics: Topic[], categories: Category[], level: 'topic' | 'category' = 'topic', recentDays = 60, today?: string): WeakArea[] {
  const cutoff = today ? shift(today, -recentDays) : '';
  const tName = new Map(topics.map(t => [t.id, t]));
  const cName = new Map(categories.map(c => [c.id, c.name]));
  const bucket = new Map<string, { a: Attempt[]; s: RevisionSchedule[] }>();
  const keyOf = (x: { topicId: string; categoryId: string }) => (level === 'topic' ? x.topicId : x.categoryId);
  for (const a of attempts) {
    if (cutoff && a.date < cutoff) continue;
    const k = keyOf(a);
    if (!k) continue;
    if (!bucket.has(k)) bucket.set(k, { a: [], s: [] });
    bucket.get(k)!.a.push(a);
  }
  for (const s of schedules) {
    const k = keyOf(s);
    if (!k || !bucket.has(k)) continue;
    bucket.get(k)!.s.push(s);
  }
  const out: WeakArea[] = [];
  for (const [key, { a, s }] of bucket) {
    if (!a.length) continue;
    const avgScore = Math.round(a.reduce((n, x) => n + x.score, 0) / a.length);
    const avgConfidence = +(a.reduce((n, x) => n + (x.confidence || 3), 0) / a.length).toFixed(1);
    const weakQs = s.filter(x => x.status === 'Weak');
    const lapses = s.reduce((n, x) => n + x.lapses, 0);
    // severity: low score dominates, then weak count ratio and low confidence
    const weakRatio = s.length ? weakQs.length / s.length : 0;
    const severity = Math.round(Math.min(100, (100 - avgScore) * 0.6 + weakRatio * 25 + (5 - avgConfidence) * 3.75));
    const t = tName.get(key);
    out.push({
      key,
      level,
      name: level === 'topic' ? t?.name || 'Unknown topic' : cName.get(key) || 'Unknown category',
      categoryName: level === 'topic' ? cName.get(t?.categoryId || '') : undefined,
      attempts: a.length,
      avgScore,
      avgConfidence,
      weakQuestions: weakQs.length,
      lapses,
      severity,
      questionIds: [...new Set([...weakQs.map(x => x.questionId), ...a.filter(x => x.score < 60).map(x => x.questionId)])],
    });
  }
  return out.filter(w => w.avgScore < 70 || w.weakQuestions > 0).sort((x, y) => y.severity - x.severity);
}

function shift(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
