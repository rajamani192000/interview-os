import { describe, expect, it } from 'vitest';
import { LADDER, ratingFromScore, review, statusOf } from '../../src/app/core/logic/srs';

const q = { questionId: 'q1', categoryId: 'c', topicId: 't' };
const T = '2026-09-26';

describe('spaced repetition', () => {
  it('new question rated good goes to step 0 → 1 day', () => {
    const s = review(null, q, 'good', T, 4);
    expect(s.step).toBe(0);
    expect(s.intervalDays).toBe(LADDER[0]);
    expect(s.dueDate).toBe('2026-09-27');
    expect(s.correct).toBe(1);
    expect(s.incorrect).toBe(0);
    expect(s.confidence).toBe(4);
  });
  it('climbs the ladder on repeated good answers and becomes Strong then Mastered', () => {
    let s = review(null, q, 'good', T, 5);
    for (let i = 0; i < 4; i++) s = review(s, q, 'good', s.dueDate, 5);
    expect(s.step).toBe(4);
    expect(s.intervalDays).toBe(30);
    expect(s.status).toBe('Mastered');
    s = review({ ...s, step: 2, streak: 1 }, q, 'good', s.dueDate, 5);
    expect(s.status).toBe('Strong');
  });
  it('again resets to 1 day, counts a lapse and marks Weak', () => {
    let s = review(null, q, 'good', T);
    s = review(s, q, 'good', s.dueDate);
    s = review(s, q, 'again', s.dueDate, 1);
    expect(s.intervalDays).toBe(1);
    expect(s.lapses).toBe(1);
    expect(s.incorrect).toBe(1);
    expect(s.status).toBe('Weak');
  });
  it('easy skips a step', () => {
    const s = review(null, q, 'easy', T);
    expect(s.step).toBe(1);
    expect(s.intervalDays).toBe(3);
  });
  it('hard never grows beyond 3-day step', () => {
    let s = review(null, q, 'easy', T);
    s = review(s, q, 'easy', s.dueDate);
    s = review(s, q, 'hard', s.dueDate);
    expect(s.step).toBeLessThanOrEqual(1);
    expect(s.intervalDays).toBeLessThanOrEqual(3);
  });
  it('derives Due / Overdue / New by date', () => {
    const s = review(null, q, 'good', T);
    expect(statusOf(null, T)).toBe('New');
    expect(statusOf(s, '2026-09-27')).toBe('Due');
    expect(statusOf(s, '2026-09-29')).toBe('Overdue');
    expect(statusOf(s, T)).toBe('Learning');
  });
  it('uses a custom ladder from system settings', () => {
    const s = review(null, q, 'easy', T, 3, [2, 5, 10]);
    expect(s.intervalDays).toBe(5);
  });
  it('maps scores to ratings', () => {
    expect(ratingFromScore(90)).toBe('easy');
    expect(ratingFromScore(70)).toBe('good');
    expect(ratingFromScore(50)).toBe('hard');
    expect(ratingFromScore(10)).toBe('again');
  });
});
