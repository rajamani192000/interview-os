import { Question, SpeechMetrics } from '../models';
import { normalizeText, tokens } from '../util';

const FILLERS = ['um', 'uh', 'erm', 'hmm', 'like', 'basically', 'actually', 'you know', 'i mean', 'sort of', 'kind of', 'literally', 'so yeah'];

export function speechMetrics(text: string, durationSec: number): SpeechMetrics {
  const clean = (text || '').toLowerCase();
  const words = clean.split(/\s+/).filter(Boolean).length;
  const fillerWords: Record<string, number> = {};
  let fillers = 0;
  for (const f of FILLERS) {
    const n = (clean.match(new RegExp(`\\b${f}\\b`, 'g')) || []).length;
    if (n) { fillerWords[f] = n; fillers += n; }
  }
  const wpm = durationSec > 5 ? Math.round(words / (durationSec / 60)) : 0;
  return { words, wpm, fillers, fillerWords };
}

export interface LocalEvaluation {
  score: number;
  covered: string[];
  missed: string[];
  feedback: string[];
}

/**
 * Offline (no-AI) evaluation: checks which key points from the user's own model answer
 * are present in the spoken/typed answer. It is a coverage check, not a judgement of correctness.
 */
export function evaluateLocally(q: Pick<Question, 'answer' | 'keyPoints' | 'question'>, answer: string, durationSec = 0): LocalEvaluation {
  const ans = normalizeText(answer);
  const ansTokens = tokens(answer);
  const points = q.keyPoints?.length ? q.keyPoints : fallbackPoints(q.answer);
  const covered: string[] = [], missed: string[] = [];
  for (const p of points) {
    const pt = [...tokens(p)].filter(w => w.length > 2);
    if (!pt.length) continue;
    const hit = pt.filter(w => ansTokens.has(w) || ans.includes(w)).length / pt.length;
    (hit >= 0.5 ? covered : missed).push(p);
  }
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const coverage = points.length ? covered.length / points.length : 0;
  let score = Math.round(coverage * 80 + Math.min(words / 80, 1) * 20);
  if (words < 15) score = Math.min(score, 30);
  const feedback: string[] = [];
  if (!points.length) feedback.push('This question has no key points yet, so only answer length was checked. Compare with the model answer yourself.');
  if (words < 25) feedback.push('Answer is very short. Aim for a one-line definition, how it works, and one real example.');
  if (coverage >= 0.8) feedback.push('You covered almost every key point.');
  else if (missed.length) feedback.push(`Mention next time: ${missed.slice(0, 3).join('; ')}.`);
  if (!/for example|e\.g\.|in my project|we used|i used|in our/i.test(answer) && words >= 25) feedback.push('Add a concrete example from your own project.');
  if (durationSec > 0) {
    const m = speechMetrics(answer, durationSec);
    if (m.fillers >= 4) feedback.push(`Filler words used ${m.fillers} times. Pause silently instead.`);
    if (m.wpm > 170) feedback.push(`Fast pace (${m.wpm} words/min). Slow down slightly.`);
  }
  return { score: Math.max(0, Math.min(100, score)), covered, missed, feedback };
}

function fallbackPoints(answer: string): string[] {
  return (answer || '')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20)
    .slice(0, 5)
    .map(s => s.split(/[,;:–-]/)[0].slice(0, 80));
}
