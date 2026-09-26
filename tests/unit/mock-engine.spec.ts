import { describe, expect, it } from 'vitest';
import { adjustLevel, buildReport, EngineCtx, EngineState, evaluateTurn, initialLevel, isIdk, nextStep, phaseFor } from '../../src/app/core/logic/mock-engine';
import { Category, MockConfig, MockTurn, Question, Topic } from '../../src/app/core/models';

const cats: Category[] = [{ id: 'net', name: '.NET', slug: 'net', order: 0, isActive: true, isArchived: false }, { id: 'sql', name: 'SQL', slug: 'sql', order: 1, isActive: true, isArchived: false }, { id: 'hr', name: 'HR', slug: 'hr', order: 2, isActive: true, isArchived: false }];
const topics: Topic[] = [{ id: 'linq', categoryId: 'net', name: 'LINQ', slug: 'linq', order: 0, isActive: true, isArchived: false }, { id: 'di', categoryId: 'net', name: 'DI', slug: 'di', order: 1, isActive: true, isArchived: false }, { id: 'idx', categoryId: 'sql', name: 'Indexes', slug: 'idx', order: 0, isActive: true, isArchived: false }];
const Q = (id: string, cat: string, topic: string, text: string, difficulty: Question['difficulty'] = 'Medium', extra: Partial<Question> = {}): Question => ({ id, categoryId: cat, topicId: topic, question: text, answer: 'Model answer for ' + text, keyPoints: ['deferred execution', 'expression trees'], difficulty, type: 'Concept', tags: [], followUps: ['When would you avoid it?'], priority: 2, hash: id, isActive: true, isArchived: false, ...extra });
const qs = [
  Q('q1', 'net', 'linq', 'Explain the difference between IEnumerable and IQueryable in .NET'),
  Q('q2', 'net', 'di', 'What is dependency injection in ASP.NET Core?', 'Easy'),
  Q('q3', 'sql', 'idx', 'Clustered vs non-clustered index in SQL Server?', 'Hard'),
  Q('q4', 'net', 'linq', 'How does deferred execution work in LINQ?', 'Hard'),
];
const config: MockConfig = { type: 'Technical', role: 'Full Stack Developer', experience: '3–5 years', technologies: [], difficulty: 'Medium', durationMin: 30, questionCount: 3, style: 'Professional' };
const ctx = (c: Partial<MockConfig> = {}): EngineCtx => ({ config: { ...config, ...c }, name: 'Rajamani A', questions: qs, categories: cats, topics, projects: [{ name: 'Hospital ERP', tech: ['.NET', 'Angular'], challenges: 'slow reports', productionIssues: '' }], seed: 3 });
const turn = (p: Partial<MockTurn>): MockTurn => ({ n: 0, kind: 'question', prompt: '', answer: '', durationSec: 30, ...p });

describe('mock engine: flow', () => {
  it('opens with a personal introduction question', () => {
    const s = nextStep(ctx(), { turns: [], askedIds: [], level: 1, elapsedSec: 0 });
    expect(s.kind).toBe('intro');
    expect(s.prompt).toMatch(/^Hi Rajamani, let's begin for the Full Stack Developer role\. Please introduce yourself/);
  });
  it('picks the first question from a skill the candidate mentioned', () => {
    const intro = turn({ kind: 'intro', prompt: 'intro', answer: 'I have 4 years experience in .NET and Angular building web APIs.', eval: evaluateTurn('intro', 'introduce yourself', 'I have 4 years experience in .NET and Angular building web APIs.', 20, false) });
    const s = nextStep(ctx(), { turns: [intro], askedIds: [], level: 1, elapsedSec: 60 });
    expect(s.kind).toBe('question');
    expect(s.prompt).toContain('You mentioned .NET');
    expect(['q1', 'q2', 'q4']).toContain(s.questionId);
  });
  it('asks a practical-example follow-up on a weak answer, then moves on (no repeats)', () => {
    const q = qs[0];
    const weakEval = evaluateTurn('question', q.question, 'Both are interfaces for collections.', 20, false, q);
    expect(weakEval.score).toBeLessThan(50);
    const t1 = turn({ n: 1, kind: 'question', prompt: q.question, questionId: 'q1', topicId: 'linq', categoryId: 'net', answer: 'Both are interfaces for collections.', eval: weakEval });
    const st: EngineState = { turns: [turn({ kind: 'intro', eval: weakEval }), t1], askedIds: ['q1'], level: 1, elapsedSec: 300 };
    const f = nextStep(ctx(), st);
    expect(f.kind).toBe('followup');
    expect(f.prompt).toBe('Can you give me a practical example from your project?');
    const t2 = turn({ n: 2, kind: 'followup', prompt: f.prompt, questionId: 'q1', answer: 'not much', eval: evaluateTurn('followup', f.prompt, 'not much', 5, false) });
    const n = nextStep(ctx(), { ...st, turns: [...st.turns, t2] });
    expect(n.kind).toBe('question');
    expect(n.questionId).not.toBe('q1');
  });
  it('"I don\'t know": friendly interviewer gives a hint instead of marking wrong', () => {
    expect(isIdk("I don't know")).toBe(true);
    expect(isIdk('I do not know the exact syntax but the idea is that the provider translates expressions')).toBe(false);
    const e = evaluateTurn('question', qs[0].question, "I don't know", 3, false, qs[0], true);
    const t = turn({ kind: 'question', questionId: 'q1', idk: true, answer: "I don't know", eval: e });
    const f = nextStep(ctx({ style: 'Friendly' }), { turns: [turn({ kind: 'intro', eval: e }), t], askedIds: ['q1'], level: 1, elapsedSec: 200 });
    expect(f.kind).toBe('followup');
    expect(f.prompt).toMatch(/^No problem\. Here's a hint: think about deferred execution/);
    const p = nextStep(ctx({ style: 'Professional' }), { turns: [turn({ kind: 'intro', eval: e }), t], askedIds: ['q1'], level: 1, elapsedSec: 200 });
    expect(p.kind).toBe('question');
  });
  it('adapts difficulty and wraps up at the question limit or when time runs out', () => {
    expect(initialLevel({ ...config, difficulty: 'Hard', experience: '5+ years' })).toBe(3);
    expect(adjustLevel(1, 80)).toBe(2);
    expect(adjustLevel(1, 30)).toBe(0);
    const good = evaluateTurn('question', 'x', 'long answer '.repeat(10), 30, false);
    const three = [1, 2, 3].map(i => turn({ n: i, kind: 'question', questionId: 'q' + i, eval: { ...good, score: 90, missed: [], examples: true } }));
    const s = nextStep(ctx({ style: 'Friendly' }), { turns: [turn({ kind: 'intro', eval: good }), ...three], askedIds: ['q1', 'q2', 'q3'], level: 2, elapsedSec: 600 });
    expect(s.kind).toBe('wrapup');
    const late = nextStep(ctx(), { turns: [turn({ kind: 'intro', eval: good })], askedIds: [], level: 1, elapsedSec: 30 * 60 - 60 });
    expect(late.kind).toBe('wrapup');
    expect(nextStep(ctx(), { turns: [turn({ kind: 'wrapup', eval: good })], askedIds: [], level: 1, elapsedSec: 700 }).kind).toBe('end');
  });
  it('interview types mix phases; full mock includes project and behavioural rounds', () => {
    const c = { ...config, type: 'Full Mock' as const, questionCount: 6 };
    expect([0, 1, 2, 3, 4, 5].map(i => phaseFor(i, c))).toEqual(['tech', 'tech', 'tech', 'tech', 'project', 'behavioral']);
    expect(phaseFor(0, { ...config, type: 'HR' })).toBe('behavioral');
    const pr = nextStep(ctx({ type: 'Managerial' }), { turns: [turn({ kind: 'intro', eval: evaluateTurn('intro', 'x', 'I work on .NET projects every day with my team.', 10, false) })], askedIds: [], level: 1, elapsedSec: 60 });
    expect(pr.kind).toBe('project');
    expect(pr.prompt).toContain('Hospital ERP');
  });
});

describe('mock engine: evaluation and report', () => {
  it('rewards examples, completeness and confident structure', () => {
    const strong = evaluateTurn('question', qs[0].question, 'IQueryable builds expression trees that the provider translates to SQL, so filtering runs in the database, and it uses deferred execution. IEnumerable runs in memory. For example, in my project we used IQueryable with EF Core to page large tables.', 40, false, qs[0]);
    const weak = evaluateTurn('question', qs[0].question, 'I think maybe they are kind of similar collections.', 10, false, qs[0]);
    expect(strong.score).toBeGreaterThan(weak.score + 25);
    expect(strong.examples).toBe(true);
    expect(weak.confidence).toBeLessThan(strong.confidence);
  });
  it('report scores categories, lists struggled questions with the model answer, and weak areas', () => {
    const e = (score: number, extra: Partial<MockTurn['eval']> = {}) => ({ ...evaluateTurn('question', 'x', 'answer words here for testing purposes only.', 10, false), score, ...extra });
    const turns: MockTurn[] = [
      turn({ kind: 'intro', answer: 'intro', eval: e(80, { examples: true }) }),
      turn({ kind: 'question', questionId: 'q1', topicId: 'linq', categoryId: 'net', prompt: qs[0].question, eval: e(85) }),
      turn({ kind: 'question', questionId: 'q3', topicId: 'idx', categoryId: 'sql', prompt: qs[2].question, answer: 'not sure', eval: e(35, { missed: ['B-tree'] }) }),
    ];
    const r = buildReport(turns, qs, cats, topics);
    expect(r.scores.technical).toBe(60);
    expect(r.scores.project).toBe(80);
    expect(r.scores.overall).toBeGreaterThan(0);
    expect(r.strengths).toContain('Strong understanding of LINQ');
    expect(r.improvements).toContain('Indexes explanations');
    expect(r.struggled[0]).toMatchObject({ questionId: 'q3', missed: ['B-tree'] });
    expect(r.struggled[0].betterAnswer).toContain('Model answer for Clustered');
    expect(r.weakCategories.map(c => c.name)).toEqual(['SQL']);
    expect(r.weakTopicIds).toEqual(['idx']);
  });
});
