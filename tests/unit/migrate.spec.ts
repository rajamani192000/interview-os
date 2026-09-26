import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/app/core/logic/migrate';
import { Question } from '../../src/app/core/models';
import { hashText } from '../../src/app/core/util';

const Q = (id: string, sourceId: string | undefined, text: string): Question => ({ id, sourceId, categoryId: 'c', topicId: 't', question: text, answer: '', keyPoints: [], difficulty: 'Medium', type: 'Concept', tags: [], followUps: [], priority: 1, hash: hashText(text), isActive: true, isArchived: false });

describe('migration from Interview Coach', () => {
  const bank = [Q('n1', 'c01', 'What are the four pillars of OOP?'), Q('n2', undefined, 'Explain middleware in ASP.NET Core')];
  const old = {
    questions: [
      { id: 'c01', _ref: 1, srs: { step: 3, due: '2026-10-01', attempts: 4, correct: 3, incorrect: 1, lapses: 1, conf: 4, lastResult: 'correct' }, flags: { bookmark: true, tomorrow: true, important: false }, notes: { remember: 'Use Employee example', project: '' } },
      { id: 'x9', question: 'Explain middleware in ASP.NET Core', srs: { attempts: 1, lastResult: 'incorrect', step: 0, due: '2026-09-27' } },
      { id: 'gone', srs: { attempts: 2 } },
    ],
    attempts: [{ qid: 'c01', d: '2026-09-20', result: 'correct', conf: 4, sec: 50 }, { qid: 'x9', d: '2026-09-21', result: 'incorrect', conf: 2 }, { qid: 'gone', d: '2026-09-21', result: 'correct' }],
    jobs: [{ company: 'Acme', role: 'Senior Dev', status: 'Technical Round', jd: 'Angular and .NET' }, { company: '', role: 'x' }],
  };
  it('maps schedules, attempts, bookmarks, notes and jobs; counts unmatched', () => {
    const r = migrate(old, bank, '2026-09-26');
    expect(r.schedules.map(s => s.questionId).sort()).toEqual(['n1', 'n2']);
    const s1 = r.schedules.find(s => s.questionId === 'n1')!;
    expect(s1).toMatchObject({ step: 3, intervalDays: 14, dueDate: '2026-10-01', reps: 4, correct: 3, incorrect: 1, confidence: 4, status: 'Strong' });
    expect(r.schedules.find(s => s.questionId === 'n2')!.status).toBe('Weak');
    expect(r.attempts.length).toBe(2);
    expect(r.attempts[0]).toMatchObject({ questionId: 'n1', rating: 'good', score: 75, date: '2026-09-20' });
    expect(r.bookmarks).toEqual([{ questionId: 'n1', tags: ['Bookmark', 'Interview Tomorrow'] }]);
    expect(r.notes[0].body).toBe('Remember: Use Employee example');
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].status).toBe('Technical');
    expect(r.unmatched).toBe(1);
  });
});
