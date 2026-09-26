import { describe, expect, it } from 'vitest';
import { computeAnalytics, streaks } from '../../src/app/core/logic/analytics';
import { mapJd, extractSkills } from '../../src/app/core/logic/jd';
import { evaluateLocally, speechMetrics } from '../../src/app/core/logic/scoring';
import { review } from '../../src/app/core/logic/srs';
import { weakAreas } from '../../src/app/core/logic/weak';
import { Attempt, Category, Question, Topic } from '../../src/app/core/models';

const cats: Category[] = [{ id: 'net', name: '.NET', slug: 'net', order: 0, isActive: true, isArchived: false }, { id: 'sql', name: 'SQL', slug: 'sql', order: 1, isActive: true, isArchived: false }];
const topics: Topic[] = [{ id: 'di', categoryId: 'net', name: 'Dependency Injection', slug: 'di', order: 0, isActive: true, isArchived: false }, { id: 'idx', categoryId: 'sql', name: 'Indexes', slug: 'idx', order: 0, isActive: true, isArchived: false }];
const Q = (id: string, topicId: string, categoryId: string, text: string): Question => ({ id, categoryId, topicId, question: text, answer: 'ans', keyPoints: ['constructor injection', 'service lifetime'], difficulty: 'Medium', type: 'Concept', tags: [], followUps: [], priority: 1, hash: id, isActive: true, isArchived: false });
const qs = [Q('q1', 'di', 'net', 'What is dependency injection in ASP.NET Core?'), Q('q2', 'di', 'net', 'Explain DI lifetimes'), Q('q3', 'idx', 'sql', 'Clustered vs non-clustered index in SQL Server?')];
const A = (questionId: string, topicId: string, categoryId: string, score: number, date = '2026-09-25', confidence = 3): Attempt => ({ questionId, topicId, categoryId, score, date, confidence, mode: 'recall', rating: score > 60 ? 'good' : 'again', durationSec: 60 });

describe('weak areas', () => {
  it('flags topics with low scores; ignores unpractised topics', () => {
    const at = [A('q1', 'di', 'net', 20, '2026-09-25', 1), A('q2', 'di', 'net', 40), A('q3', 'idx', 'sql', 90, '2026-09-25', 5)];
    const w = weakAreas(at, [], topics, cats, 'topic', 60, '2026-09-26');
    expect(w.length).toBe(1);
    expect(w[0].name).toBe('Dependency Injection');
    expect(w[0].questionIds.sort()).toEqual(['q1', 'q2']);
  });
});

describe('JD mapping uses only existing data', () => {
  const jd = 'We need a .NET Core Web API developer with SQL Server, Angular and Kubernetes experience.';
  it('extracts skills', () => {
    expect(extractSkills(jd)).toEqual(expect.arrayContaining(['.NET Core / ASP.NET Core', 'SQL Server', 'Angular', 'Docker / containers']));
  });
  it('labels coverage from schedules and attempts', () => {
    let s1 = review(null, { questionId: 'q3', categoryId: 'sql', topicId: 'idx' }, 'easy', '2026-09-01');
    s1 = review(s1, { questionId: 'q3', categoryId: 'sql', topicId: 'idx' }, 'easy', '2026-09-04');
    const cov = mapJd(jd, qs, topics, cats, [s1], [A('q3', 'idx', 'sql', 90), A('q1', 'di', 'net', 40)]);
    const byName = Object.fromEntries(cov.map(c => [c.skill, c]));
    expect(byName['SQL Server'].coverage).toBe('Covered');
    expect(byName['Docker / containers'].coverage).toBe('Needs preparation');
    expect(byName['Docker / containers'].related).toBe(0);
    expect(byName['.NET Core / ASP.NET Core'].coverage).toBe('Needs preparation');
  });
});

describe('analytics and scoring', () => {
  it('streak counts consecutive days and tolerates today not done yet', () => {
    expect(streaks(new Set(['2026-09-23', '2026-09-24', '2026-09-25']), '2026-09-26')).toEqual({ current: 3, best: 3 });
    expect(streaks(new Set(['2026-09-20', '2026-09-26']), '2026-09-26').current).toBe(1);
  });
  it('computes range totals', () => {
    const a = computeAnalytics('7', '2026-09-26', { attempts: [A('q1', 'di', 'net', 50), A('q3', 'idx', 'sql', 100, '2026-08-01')], sessions: [{ date: '2026-09-25', startedAt: 0, minutes: 20, questions: 1, kind: 'plan' }], plans: [], voice: [], comm: [], mocks: [], schedules: [] });
    expect(a.attempts).toBe(1);
    expect(a.avgScore).toBe(50);
    expect(a.minutes).toBe(20);
    expect(a.byDay.length).toBe(7);
  });
  it('offline evaluation checks key-point coverage', () => {
    const good = evaluateLocally(qs[0], 'Dependency injection gives a class its dependencies through constructor injection and the container manages the service lifetime such as scoped or singleton. In my project we used it for repositories.');
    const bad = evaluateLocally(qs[0], 'Not sure.');
    expect(good.score).toBeGreaterThan(70);
    expect(good.missed).toEqual([]);
    expect(bad.score).toBeLessThanOrEqual(30);
  });
  it('speech metrics count fillers and pace', () => {
    const m = speechMetrics('um so basically I um built an API you know', 30);
    expect(m.fillers).toBe(4);
    expect(m.wpm).toBe(20);
  });
});
