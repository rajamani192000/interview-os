import { inject, Injectable } from '@angular/core';
import { mapJd } from '../logic/jd';
import { CommType, CommunicationSession, InterviewTurn, Job, MockInterview, Project, Question, VoiceSession } from '../models';
import { addDays } from '../util';
import { UserCollection } from './collection';
import { CategoryService, MasterDataStore, TopicService } from './master-data.service';
import { ClockService } from './platform.service';
import { AttemptService, BookmarkService, RevisionService } from './practice.service';

/** Standard speaking-drill prompts (communication practice, not a question bank). */
export const COMM_PROMPTS: Record<CommType, string[]> = {
  'Self introduction': ['Introduce yourself for a Senior Full-Stack role in under 2 minutes.', 'Give a 60-second version of your introduction.'],
  'Explain a project': ['Explain your most recent project: the problem, your role, the architecture and the result.', 'Walk through one feature you built end to end.'],
  'STAR story': ['Describe a production issue you handled (Situation, Task, Action, Result).', 'Tell me about a time you disagreed with a technical decision.', 'Describe a time you improved performance.'],
  'Explain a concept simply': ['Explain dependency injection to a non-technical manager.', 'Explain what an API is to a new joiner.', 'Explain indexing in a database with an everyday analogy.'],
  'Why this company': ['Why do you want to join this company, and why now?'],
  'Salary & notice discussion': ['State your expected salary and notice period politely and confidently.'],
  'Free talk': ['Talk about what you learned this week.'],
};

@Injectable({ providedIn: 'root' })
export class CommunicationService extends UserCollection<CommunicationSession> {
  constructor() { super('communicationSessions', { where: [['date', '>=', addDays(new Date().toISOString().slice(0, 10), -366)]], orderBy: [['date', 'desc']], limit: 1000 }); }
  recent(n = 10) {
    return [...this.items()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, n);
  }
}

export const VOICE_MODES: { id: VoiceSession['mode']; label: string; count: number; note: string }[] = [
  { id: 'quick', label: 'Quick round', count: 3, note: '3 questions from your due and learning items' },
  { id: 'technical', label: 'Technical round', count: 5, note: '.NET, Angular, SQL questions by priority' },
  { id: 'architect', label: 'Architect round', count: 3, note: 'System design and senior-level questions' },
  { id: 'weak', label: 'Weak areas', count: 4, note: 'Questions you scored lowest on' },
  { id: 'project', label: 'Project round', count: 3, note: 'Questions about your own projects' },
  { id: 'hr', label: 'HR round', count: 3, note: 'Behavioral questions and standard HR prompts' },
];

@Injectable({ providedIn: 'root' })
export class VoiceInterviewService extends UserCollection<VoiceSession> {
  private md = inject(MasterDataStore);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private clock = inject(ClockService);
  private cats = inject(CategoryService);
  constructor() { super('voiceSessions', { where: [['date', '>=', addDays(new Date().toISOString().slice(0, 10), -366)]], orderBy: [['date', 'desc']], limit: 1000 }); }

  /** Picks questions for a mode from the user's bank. Returns plain prompts when a mode has no bank questions. */
  pick(mode: VoiceSession['mode'], projects: { name: string; tech: string[] }[] = []): { questionId?: string; question: string }[] {
    const qs = this.md.questions();
    const count = VOICE_MODES.find(m => m.id === mode)?.count ?? 3;
    const sched = this.revision.map();
    const shuffle = <T>(a: T[]) => a.map(x => [Math.random(), x] as const).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    const asItems = (l: Question[]) => l.slice(0, count).map(q => ({ questionId: q.id, question: q.question }));
    const catName = (q: Question) => this.cats.name(q.categoryId).toLowerCase();
    switch (mode) {
      case 'quick': {
        const due = this.revision.due().map(s => this.md.questionMap().get(s.questionId)).filter((q): q is Question => !!q && qs.includes(q));
        const learned = shuffle(qs.filter(q => sched.has(q.id)));
        return asItems([...new Set([...due, ...learned, ...shuffle(qs)])]);
      }
      case 'technical':
        return asItems(shuffle(qs.filter(q => /\.net|angular|sql|c#|typescript/.test(catName(q)) && q.type !== 'Behavioral')).sort((a, b) => a.priority - b.priority));
      case 'architect':
        return asItems(shuffle(qs.filter(q => q.type === 'System Design' || q.difficulty === 'Senior' || /architect/.test(catName(q)))));
      case 'weak': {
        const scores = new Map<string, number[]>();
        this.attempts.items().forEach(a => (scores.get(a.questionId) ?? scores.set(a.questionId, []).get(a.questionId)!).push(a.score));
        const weak = qs.filter(q => sched.get(q.id)?.status === 'Weak' || (scores.get(q.id) || []).some(s => s < 60));
        return asItems(shuffle(weak));
      }
      case 'project': {
        const bank = qs.filter(q => /project/i.test(q.question) || q.tags.includes('project'));
        const own = projects.flatMap(p => [`Explain the architecture of ${p.name} and why you chose ${p.tech.slice(0, 2).join(' and ') || 'that stack'}.`, `What was the hardest problem in ${p.name}, and how did you solve it?`]);
        return [...shuffle(own).map(q => ({ question: q })), ...asItems(shuffle(bank))].slice(0, count);
      }
      case 'hr': {
        const bank = qs.filter(q => q.type === 'Behavioral');
        const std = [...COMM_PROMPTS['Self introduction'], ...COMM_PROMPTS['STAR story'], ...COMM_PROMPTS['Why this company']];
        return [...asItems(shuffle(bank)), ...shuffle(std).map(q => ({ question: q }))].slice(0, count);
      }
    }
  }

  overall(turns: InterviewTurn[]) {
    return turns.length ? Math.round(turns.reduce((n, t) => n + t.score, 0) / turns.length) : 0;
  }
  today() { return this.clock.today(); }
}

@Injectable({ providedIn: 'root' })
export class MockInterviewService extends UserCollection<MockInterview> {
  private md = inject(MasterDataStore);
  private topics = inject(TopicService);
  private cats = inject(CategoryService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private bookmarks = inject(BookmarkService);
  private clock = inject(ClockService);
  constructor() { super('mockInterviews', { orderBy: [['date', 'desc']], limit: 200 }); }

  /** Builds a 3-round mock from the user's bank; tailored to a job's JD when given. */
  build(job?: Job, projects: Project[] = []): MockInterview {
    const qs = this.md.questions();
    const shuffle = <T>(a: T[]) => a.map(x => [Math.random(), x] as const).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    let tech = shuffle(qs.filter(q => q.type === 'Concept' || q.type === 'Coding')).sort((a, b) => a.priority - b.priority);
    if (job) {
      const cov = mapJd(job.jd, qs, this.topics.list(), this.cats.list(), this.revision.items(), this.attempts.items(), job.skills);
      const ids = new Set(cov.filter(c => c.coverage !== 'Covered').flatMap(c => c.questionIds).concat(cov.flatMap(c => c.questionIds)));
      tech = [...qs.filter(q => ids.has(q.id)), ...tech];
    }
    const design = shuffle(qs.filter(q => q.type === 'System Design' || q.type === 'Scenario' || q.difficulty === 'Senior'));
    const hr = shuffle(qs.filter(q => q.type === 'Behavioral'));
    const uniq = (l: Question[], n: number, used: Set<string>) => l.filter(q => !used.has(q.id) && used.add(q.id)).slice(0, n).map(q => q.id);
    const used = new Set<string>();
    const rounds = [
      { name: 'Technical', questionIds: uniq(tech, 4, used) },
      { name: 'Design & scenarios', questionIds: uniq(design, 2, used) },
      { name: 'Behavioral', questionIds: uniq(hr, 2, used) },
    ].filter(r => r.questionIds.length);
    // project round from the user's own projects (prompts reference only what they entered)
    const pr = projects.slice(0, 2).flatMap(p => [`project:${p.id}:arch`, ...(p.challenges || p.productionIssues ? [`project:${p.id}:challenge`] : [])]).slice(0, 2);
    if (pr.length) rounds.splice(1, 0, { name: 'Project deep-dive', questionIds: pr });
    return { title: job ? `Mock for ${job.company} – ${job.title}` : 'Full mock interview', jobId: job?.id, rounds, turns: [], status: 'in-progress', durationSec: 0, date: this.clock.today() };
  }

  /** Resolves a round item: bank question id or a project prompt key. */
  promptFor(key: string, projects: Project[]): { question: string; q?: Question; reference?: string } {
    if (key.startsWith('project:')) {
      const [, id, kind] = key.split(':');
      const p = projects.find(x => x.id === id);
      if (!p) return { question: 'Walk me through a recent project you are proud of.' };
      const ref = [p.architecture, p.responsibilities, p.challenges, p.solution, p.performance, p.productionIssues, p.impact].filter(Boolean).join('\n');
      return kind === 'arch'
        ? { question: `Walk me through ${p.name}: your role, the architecture and why you chose ${p.tech.slice(0, 3).join(', ') || 'that stack'}.`, reference: ref }
        : { question: `What was the hardest challenge or production issue in ${p.name}, and how did you solve it?`, reference: ref };
    }
    const q = this.md.questionMap().get(key);
    return { question: q?.question || 'Question no longer available', q };
  }

  summarize(m: MockInterview): Pick<MockInterview, 'overall' | 'strengths' | 'improvements'> {
    const overall = m.turns.length ? Math.round(m.turns.reduce((n, t) => n + t.score, 0) / m.turns.length) : 0;
    const good = m.turns.filter(t => t.score >= 70).map(t => t.question);
    const bad = m.turns.filter(t => t.score < 60);
    return {
      overall,
      strengths: good.slice(0, 3).map(q => `Solid answer: ${q.slice(0, 80)}`),
      improvements: [...new Set(bad.flatMap(t => t.missed))].slice(0, 5).map(x => `Cover: ${x}`),
    };
  }
  interviewTomorrow() { return this.bookmarks.withTag('Interview Tomorrow'); }
}
