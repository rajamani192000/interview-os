import { inject, Injectable } from '@angular/core';
import { DATA_STORE, SERVER_TIME } from '../data/store';
import { mapJd } from '../logic/jd';
import { buildReport, EngineCtx, EngineState, evaluateTurn, initialLevel, nextStep, NextStep, adjustLevel } from '../logic/mock-engine';
import { ratingFromScore } from '../logic/srs';
import { EXPERIENCE_LEVELS, MockConfig, MockInterview, MockTurn, SkillProgress } from '../models';
import { clean } from '../util';
import { AIInterviewService } from './ai.service';
import { JobService, ProjectService } from './career.service';
import { UserCollection } from './collection';
import { CategoryService, MasterDataStore, TopicService } from './master-data.service';
import { DailyPlanService } from './plan.service';
import { ClockService } from './platform.service';
import { AttemptService, RevisionService } from './practice.service';
import { MockInterviewService } from './speaking.service';
import { UserService } from './user.service';
import { AuthService } from './auth.service';

/** users/{uid}/skillProgress/{topicId}: rolling topic scores across mock interviews. */
@Injectable({ providedIn: 'root' })
export class SkillProgressService extends UserCollection<SkillProgress> {
  constructor() { super('skillProgress'); }
}

export const DEFAULT_MOCK_CONFIG: MockConfig = {
  type: 'Full Mock', role: 'Full Stack Developer', experience: '3–5 years', technologies: [], difficulty: 'Medium', durationMin: 30, questionCount: 6, style: 'Professional',
};

/**
 * Runs a dynamic mock interview: builds the engine context from Firestore data (bank, projects,
 * jobs, earlier weak topics), evaluates each answer (AI when configured, otherwise the offline
 * check), asks follow-ups, saves every turn, and on finish writes the report, topic progress and
 * revision attempts.
 */
@Injectable({ providedIn: 'root' })
export class MockEngineService {
  private store = inject(DATA_STORE);
  private mocks = inject(MockInterviewService);
  private skills = inject(SkillProgressService);
  private md = inject(MasterDataStore);
  private cats = inject(CategoryService);
  private topics = inject(TopicService);
  private projects = inject(ProjectService);
  private jobs = inject(JobService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private ai = inject(AIInterviewService);
  private user = inject(UserService);
  private plan = inject(DailyPlanService);
  private clock = inject(ClockService);
  private auth = inject(AuthService);

  async ensureLoaded() {
    await Promise.all([this.md.ensureLoaded(), this.mocks.ensureLoaded(), this.projects.ensureLoaded(), this.jobs.ensureLoaded(), this.revision.ensureLoaded(), this.attempts.ensureLoaded(), this.skills.ensureLoaded(), this.user.ensureLoaded()]);
  }

  experienceFromProfile(): MockConfig['experience'] {
    const y = this.user.profile()?.yearsExperience;
    if (y === undefined || y === null) return DEFAULT_MOCK_CONFIG.experience;
    return y < 1 ? EXPERIENCE_LEVELS[0] : y < 3 ? EXPERIENCE_LEVELS[1] : y < 5 ? EXPERIENCE_LEVELS[2] : EXPERIENCE_LEVELS[3];
  }

  /** Last used configuration (users/{uid}/settings/mock). */
  async lastConfig(): Promise<MockConfig | null> {
    try { return await this.store.get<MockConfig>(`users/${this.mocksUid()}/settings/mock`); } catch { return null; }
  }
  private mocksUid() { return this.auth.uid()!; }

  ctx(m: MockInterview): EngineCtx {
    const c = m.config!;
    const job = c.jobId ? this.jobs.byId(c.jobId) : null;
    const qs = this.md.questions();
    const jdIds = job ? mapJd(job.jd, qs, this.topics.list(), this.cats.list(), this.revision.items(), this.attempts.items(), job.skills).filter(x => x.coverage !== 'Covered').flatMap(x => x.questionIds) : [];
    const weak = this.skills.items().filter(s => s.avg < 60).map(s => s.topicId);
    return {
      config: c, name: this.user.profile()?.displayName || 'there', questions: qs, categories: this.cats.list(), topics: this.topics.list(),
      projects: this.projects.items(), job: job || null, jdQuestionIds: jdIds, historyWeakTopicIds: weak, seed: (m.startedAt || 1) % 100000,
    };
  }

  state(m: MockInterview): EngineState {
    return { turns: m.mturns || [], askedIds: m.askedIds || [], level: m.level ?? initialLevel(m.config!), elapsedSec: m.durationSec || 0 };
  }

  async start(config: MockConfig): Promise<MockInterview & { id: string }> {
    const job = config.jobId ? this.jobs.byId(config.jobId) : null;
    const title = config.type === 'Company-specific' && job ? `${job.company} – ${job.title}` : `${config.type} · ${config.role}${config.focusTopicIds?.length ? ' (improvement)' : ''}`;
    const m: MockInterview = { version: 2, title, jobId: config.jobId, config, rounds: [], turns: [], mturns: [], askedIds: [], level: initialLevel(config), status: 'in-progress', durationSec: 0, startedAt: this.clock.now(), date: this.clock.today() };
    await this.store.set(`users/${this.mocksUid()}/settings/mock`, clean({ ...config, focusTopicIds: undefined, updatedAt: SERVER_TIME })).catch(() => undefined);
    const saved = await this.mocks.save(m);
    return saved;
  }

  /** Interviewer's next line for the current state. */
  next(m: MockInterview): NextStep {
    return nextStep(this.ctx(m), this.state(m));
  }

  /** Evaluates the candidate's answer to the current prompt and saves progress. */
  async answer(m: MockInterview & { id: string }, step: NextStep, answer: string, durationSec: number, spoken: boolean, idk: boolean, elapsedSec: number): Promise<MockInterview & { id: string }> {
    const q = step.questionId ? this.md.questionMap().get(step.questionId) : undefined;
    const turns = m.mturns || [];
    let aiScore: number | undefined, aiMissed: string[] | undefined, aiFeedback: string[] | undefined, followUp: string | undefined;
    if (!idk && answer.trim() && this.ai.provider() !== 'none') {
      const conv = turns.slice(-4).map(t => `Interviewer: ${t.prompt}\nCandidate: ${t.answer}`).join('\n');
      const p = this.user.profile();
      const ev = await this.ai.evaluate({ question: step.prompt, answer: q?.answer || '', keyPoints: q?.keyPoints || [] }, answer, spoken ? durationSec : 0, { role: m.config!.role, years: p?.yearsExperience, mode: m.config!.type, conversation: conv, style: m.config!.style });
      if (!ev.fellBack && ev.provider !== 'none') { aiScore = ev.score; aiMissed = ev.missed; aiFeedback = ev.feedback; followUp = ev.followUp; }
    }
    const kind = step.kind === 'end' ? 'wrapup' : step.kind;
    const ev = { ...evaluateTurn(kind, step.prompt, answer, durationSec, spoken, q, idk, aiScore, aiMissed, aiFeedback), ...(followUp ? { followUp } : {}) };
    const turn: MockTurn = clean({ n: turns.length, kind, prompt: step.prompt, questionId: step.questionId, categoryId: step.categoryId, topicId: step.topicId, level: step.level, answer: answer.slice(0, 6000), idk, durationSec: Math.round(durationSec), eval: ev });
    const technical = (kind === 'question' || kind === 'followup') && !!q;
    const next: MockInterview & { id: string } = {
      ...m,
      mturns: [...turns, turn],
      askedIds: step.questionId && !m.askedIds?.includes(step.questionId) ? [...(m.askedIds || []), step.questionId] : m.askedIds || [],
      level: technical && !idk ? adjustLevel(m.level ?? 1, ev.score) : idk ? Math.max(0, (m.level ?? 1) - 1) : m.level,
      durationSec: Math.round(elapsedSec),
    };
    await this.mocks.save(next, m.id);
    return next;
  }

  /** Completes the interview: report, topic progress, revision attempts, plan item. */
  async finish(m: MockInterview & { id: string }, elapsedSec: number): Promise<MockInterview & { id: string }> {
    const report = buildReport(m.mturns || [], this.md.questions(), this.cats.list(), this.topics.list());
    const done: MockInterview & { id: string } = {
      ...m, status: 'completed', report, overall: report.scores.overall, strengths: report.strengths, improvements: report.improvements,
      durationSec: Math.round(elapsedSec), endedAt: this.clock.now(),
    };
    await this.mocks.save(done, m.id);
    // topic progress (rolling last 20 samples)
    const today = this.clock.today();
    for (const t of report.topicScores) {
      const prev = this.skills.byId(t.topicId);
      const samples = [...(prev?.samples || []).filter(s => s.mockId !== m.id), { date: today, score: t.score, mockId: m.id }].slice(-20);
      const avg = Math.round(samples.reduce((n, s) => n + s.score, 0) / samples.length);
      await this.skills.save({ topicId: t.topicId, categoryId: this.topics.get(t.topicId)?.categoryId || '', name: t.name, samples, avg }, t.topicId).catch(() => undefined);
    }
    // bank questions answered in the mock also update the revision schedule
    const seen = new Set<string>();
    for (const t of m.mturns || []) {
      if (!t.questionId || seen.has(t.questionId) || !t.eval || t.kind === 'followup') continue;
      seen.add(t.questionId);
      const q = this.md.questionMap().get(t.questionId);
      if (q) await this.attempts.record(q, { mode: 'mock', rating: t.idk ? 'again' : ratingFromScore(t.eval.score), score: t.eval.score, confidence: Math.max(1, Math.min(5, Math.round(t.eval.confidence / 20))), durationSec: t.durationSec, answerText: t.answer }).catch(() => undefined);
    }
    await this.plan.ensureToday().catch(() => undefined);
    await this.plan.completeMatching('mock').catch(() => undefined);
    return done;
  }
}
