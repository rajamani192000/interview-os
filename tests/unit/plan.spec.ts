import { describe, expect, it } from 'vitest';
import { buildPlan, missedStudyDays, planMode, planProgress, PlanInput } from '../../src/app/core/logic/plan';
import { review } from '../../src/app/core/logic/srs';
import { Question } from '../../src/app/core/models';

const Q = (i: number, cat = 'c1', priority = 2): Question => ({ id: 'q' + i, categoryId: cat, topicId: 't', question: 'Question number ' + i, answer: 'a', keyPoints: [], difficulty: 'Medium', type: 'Concept', tags: [], followUps: [], priority, hash: 'h' + i, isActive: true, isArchived: false });
const qs = Array.from({ length: 40 }, (_, i) => Q(i, i % 2 ? 'c1' : 'c2', i < 5 ? 1 : 2));
const T = '2026-09-26';
const base: PlanInput = { today: T, dailyMinutes: 45, newPerDay: 3, voiceEnabled: true, questions: qs, schedules: [], weakQuestionIds: [], focusCategoryIds: [] };

describe('daily plan', () => {
  it('fresh user: new questions by priority + communication + voice within budget', () => {
    const p = buildPlan(base);
    expect(p.mode).toBe('normal');
    expect(p.items.filter(i => i.type === 'new').length).toBe(3);
    expect(p.items.filter(i => i.type === 'new').every(i => ['q0', 'q1', 'q2', 'q3', 'q4'].includes(i.refId!))).toBe(true);
    expect(p.items.some(i => i.type === 'communication')).toBe(true);
    expect(p.items.some(i => i.type === 'voice')).toBe(true);
    expect(p.minutesPlanned).toBeLessThanOrEqual(45);
  });
  it('due revisions come first, most overdue first', () => {
    const s1 = { ...review(null, { questionId: 'q10', categoryId: 'c1', topicId: 't' }, 'good', '2026-09-20'), dueDate: '2026-09-21' };
    const s2 = { ...review(null, { questionId: 'q11', categoryId: 'c1', topicId: 't' }, 'good', '2026-09-20'), dueDate: '2026-09-25' };
    const p = buildPlan({ ...base, schedules: [s2, s1], lastStudyDay: '2026-09-25' });
    const rev = p.items.filter(i => i.type === 'revision');
    expect(rev.map(i => i.refId)).toEqual(['q10', 'q11']);
    expect(p.items[0].type).toBe('revision');
  });
  it('recovery mode after 2+ missed study days: 3 revision + 2 weak + 1 communication + 1 voice, ~15 min', () => {
    const scheds = ['q1', 'q2', 'q3', 'q4'].map(id => ({ ...review(null, { questionId: id, categoryId: 'c1', topicId: 't' }, 'good', '2026-09-10'), dueDate: '2026-09-12' }));
    const p = buildPlan({ ...base, schedules: scheds, weakQuestionIds: ['q7', 'q8', 'q9'], lastStudyDay: '2026-09-21' });
    expect(p.mode).toBe('recovery');
    expect(p.items.filter(i => i.type === 'revision').length).toBe(3);
    expect(p.items.filter(i => i.type === 'weak').length).toBe(2);
    expect(p.items.filter(i => i.type === 'communication').length).toBe(1);
    expect(p.items.filter(i => i.type === 'voice').length).toBe(1);
    expect(p.minutesPlanned).toBe(15);
  });
  it('missed days only count planned study days', () => {
    // Mon-Fri study days; last study Friday 2026-09-18, today Monday 2026-09-21 → weekend not missed
    expect(missedStudyDays('2026-09-18', '2026-09-21', [1, 2, 3, 4, 5])).toBe(0);
    expect(missedStudyDays('2026-09-18', '2026-09-23', [1, 2, 3, 4, 5])).toBe(2);
  });
  it('interview within 3 days switches to interview mode with no new questions', () => {
    const p = buildPlan({ ...base, interviewDate: '2026-09-28', interviewTomorrowIds: ['q20', 'q21'] });
    expect(planMode({ ...base, interviewDate: '2026-09-28' })).toBe('interview');
    expect(p.items.some(i => i.type === 'new')).toBe(false);
    expect(p.items.slice(0, 2).map(i => i.refId)).toEqual(['q20', 'q21']);
  });
  it('empty bank produces only speaking items; progress helper works', () => {
    const p = buildPlan({ ...base, questions: [] });
    expect(p.items.every(i => i.type === 'communication' || i.type === 'voice')).toBe(true);
    p.items[0].done = true;
    expect(planProgress(p).done).toBe(1);
    expect(planProgress(null).total).toBe(0);
  });
});
