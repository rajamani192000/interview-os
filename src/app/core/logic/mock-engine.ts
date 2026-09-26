/**
 * Dynamic mock-interview engine (pure, unit-tested).
 *
 *   Answer → Evaluate → (Follow-up | Select next question) → … → Wrap-up → Report
 *
 * Questions come only from the user's own bank, projects and tracked jobs, plus a few standard
 * interviewer prompts (introduction, HR/managerial openers). Nothing is invented about the user.
 */
import { Category, Job, MockConfig, MockReport, MockTurn, MockTurnKind, Project, Question, Topic, TurnEval } from '../models';
import { extractSkills, SKILLS } from './jd';
import { evaluateLocally, speechMetrics } from './scoring';

export const LEVEL_NAMES = ['Easy', 'Medium', 'Hard', 'Senior'] as const;
const DIFF_LEVEL: Record<string, number> = { Easy: 0, Medium: 1, Hard: 2, Senior: 3 };

/** Standard prompts a real interviewer uses; used only when the bank has no behavioural questions. */
export const HR_PROMPTS = [
  'Tell me about a time you disagreed with a teammate. How did you handle it?',
  'Describe a production issue you owned from start to finish. What happened and what did you learn?',
  'Why are you looking for a change right now?',
  'Where do you see yourself in the next three years?',
  'Tell me about a time you missed a deadline. What did you do?',
  'What are your strengths, and one area you are actively improving?',
];
export const MANAGERIAL_PROMPTS = [
  'Two urgent tasks land on you on the same day with the same deadline. How do you prioritise and communicate?',
  'How do you review a junior developer’s code and give feedback they will actually act on?',
  'A stakeholder keeps changing requirements mid-sprint. How do you handle it?',
  'How would you estimate a feature you have never built before?',
  'Tell me about a technical decision you made that you would change today.',
];

export interface EngineCtx {
  config: MockConfig;
  name: string;
  questions: Question[]; // active bank
  categories: Category[];
  topics: Topic[];
  projects: Pick<Project, 'name' | 'tech' | 'challenges' | 'productionIssues'>[];
  job?: Pick<Job, 'company' | 'title' | 'jd' | 'skills'> | null;
  jdQuestionIds?: string[]; // questions for the job's uncovered skills
  historyWeakTopicIds?: string[]; // weak topics from earlier interviews
  seed?: number;
}

export interface EngineState {
  turns: MockTurn[];
  askedIds: string[];
  level: number;
  elapsedSec: number;
}

export interface NextStep {
  kind: MockTurnKind | 'end';
  prompt: string;
  questionId?: string;
  categoryId?: string;
  topicId?: string;
  level?: number;
}

export function initialLevel(c: MockConfig): number {
  let l = c.difficulty === 'Easy' ? 0 : c.difficulty === 'Hard' ? 2 : 1;
  if (c.experience === '5+ years' && c.difficulty === 'Hard') l = 3;
  if (c.experience === 'Fresher') l = Math.min(l, 1);
  return l;
}

/** Adaptive difficulty after a scored technical answer. */
export function adjustLevel(level: number, score: number): number {
  if (score >= 75) return Math.min(3, level + 1);
  if (score < 45) return Math.max(0, level - 1);
  return level;
}

export function mainCount(turns: MockTurn[]) {
  return turns.filter(t => t.kind === 'question' || t.kind === 'project' || t.kind === 'behavioral').length;
}

type Phase = 'tech' | 'project' | 'behavioral' | 'managerial' | 'company';
/** Which kind of question the i-th main question should be, by interview type. */
export function phaseFor(i: number, c: MockConfig): Phase {
  const n = Math.max(1, c.questionCount);
  switch (c.type) {
    case 'HR': return 'behavioral';
    case 'Managerial': return i === 0 ? 'project' : i % 2 ? 'managerial' : 'behavioral';
    case 'Full Mock': { const t = Math.max(1, Math.round(n * 0.6)); return i < t ? 'tech' : i === t ? 'project' : (i - t) % 2 ? 'behavioral' : 'managerial'; }
    case 'Company-specific': return i === 0 ? 'company' : i === n - 1 ? 'project' : 'tech';
    case 'Role-specific': return i === n - 1 && n > 2 ? 'project' : 'tech';
    default: return 'tech';
  }
}

function ack(style: MockConfig['style'], score: number | undefined, rnd: () => number): string {
  if (score === undefined) return '';
  const pick = (a: string[]) => a[Math.floor(rnd() * a.length)];
  if (style === 'Friendly') return score >= 70 ? pick(['Nice, that was clear. ', 'Good answer. ', 'Great, thanks. ']) : pick(['Thanks, that helps. ', 'Okay, no problem. ', 'Alright, thanks for trying. ']);
  if (style === 'Challenging') return score >= 80 ? pick(['Fine. ', 'Okay. ']) : pick(['That was incomplete. ', 'Not quite. ', 'Hmm. ']);
  return score >= 70 ? pick(['Good. ', 'Okay. ', 'Alright. ']) : pick(['Okay. ', 'Alright, let’s move on. ']);
}

function rng(seed: number) {
  let s = seed || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const techCats = (ctx: EngineCtx) => {
  const ids = ctx.config.technologies.length ? ctx.config.technologies : ctx.categories.map(c => c.id);
  return new Set(ids);
};

/** Skills (from the JD skill vocabulary) mentioned in the candidate's answers so far. */
export function mentionedSkills(turns: MockTurn[]): string[] {
  return [...new Set(turns.flatMap(t => extractSkills(t.answer || '')))];
}

/** The words the candidate actually used for a skill (e.g. ".NET"), for a natural "You mentioned …". */
function mentionedText(turns: MockTurn[], skill: string): string | null {
  const re = SKILLS.find(([n]) => n === skill)?.[1];
  if (!re) return null;
  for (const t of turns) { const m = re.exec(t.answer || ''); if (m) return m[0].trim(); }
  return null;
}

function skillMatches(q: Question, skill: string, ctx: EngineCtx): boolean {
  const re = SKILLS.find(([n]) => n === skill)?.[1];
  if (!re) return false;
  const cat = ctx.categories.find(c => c.id === q.categoryId)?.name || '';
  const top = ctx.topics.find(t => t.id === q.topicId)?.name || '';
  return re.test(q.question) || re.test(cat) || re.test(top);
}

/** Picks the best next technical question for the current state. */
export function selectQuestion(ctx: EngineCtx, st: EngineState, pool: Question[], rnd: () => number): { q: Question; because?: string } | null {
  const asked = new Set(st.askedIds);
  const coveredTopics = new Set(st.turns.map(t => t.topicId).filter(Boolean));
  const focus = new Set(ctx.config.focusTopicIds || []);
  const jd = new Set(ctx.jdQuestionIds || []);
  const weak = new Set(ctx.historyWeakTopicIds || []);
  const skills = mentionedSkills(st.turns.filter(t => t.kind === 'intro' || t.kind === 'project'));
  const firstAfterIntro = mainCount(st.turns) === 0;
  let best: { q: Question; s: number; because?: string } | null = null;
  for (const q of pool) {
    if (asked.has(q.id)) continue;
    let s = 0;
    const lvl = DIFF_LEVEL[q.difficulty] ?? 1;
    s -= Math.abs(lvl - st.level) * 3; // match current difficulty
    if (!coveredTopics.has(q.topicId)) s += 4; // spread across topics
    if (focus.size && focus.has(q.topicId)) s += 8;
    if (jd.has(q.id)) s += 5;
    if (weak.has(q.topicId)) s += 1.5;
    if (q.priority === 1) s += 1;
    let because: string | undefined;
    if (firstAfterIntro && skills.length) {
      const hit = skills.find(k => skillMatches(q, k, ctx));
      if (hit) { s += 6; because = mentionedText(st.turns, hit) || hit; }
    }
    s += rnd() * 1.5; // variety
    if (!best || s > best.s) best = { q, s, because };
  }
  return best ? { q: best.q, because: best.because } : null;
}

/** Decides the interviewer's next move. */
export function nextStep(ctx: EngineCtx, st: EngineState): NextStep {
  const c = ctx.config;
  const rnd = rng((ctx.seed || 7) + st.turns.length * 31);
  const remaining = c.durationMin * 60 - st.elapsedSec;
  const last = st.turns[st.turns.length - 1];
  const first = ctx.name.split(' ')[0] || 'there';

  if (!st.turns.length) {
    const hello = c.style === 'Friendly' ? `Hi ${first}, thanks for joining. Let's begin` : c.style === 'Challenging' ? `${first}, let's get started` : `Hi ${first}, let's begin`;
    const where = c.type === 'Company-specific' && ctx.job ? ` for the ${ctx.job.title} role at ${ctx.job.company}` : ` for the ${c.role} role`;
    return { kind: 'intro', prompt: `${hello}${where}. Please introduce yourself and tell me about your current role.` };
  }
  if (last?.kind === 'wrapup' || remaining <= 0) return { kind: 'end', prompt: closing(c.style, first) };

  // Follow-up on the last answer (conversation context), at most 1 (2 when challenging) per question
  if (last && last.eval && last.kind !== 'intro') {
    const chain = followupChain(st.turns);
    const maxFollow = c.style === 'Challenging' ? 2 : 1;
    if (chain < maxFollow && remaining > 120) {
      const f = followUpFor(ctx, last, st, rnd);
      if (f) return { kind: 'followup', prompt: f, questionId: last.questionId, categoryId: last.categoryId, topicId: last.topicId, level: st.level };
    }
  }

  const done = mainCount(st.turns);
  if (done >= c.questionCount || remaining <= 90) {
    return { kind: 'wrapup', prompt: `${ack(c.style, last?.eval?.score, rnd)}We're ${remaining <= 90 ? 'almost out of time' : 'at the end of my questions'}. Do you have any questions for me, or anything you'd like to add?` };
  }

  const pre = ack(c.style, last?.idk ? 30 : last?.eval?.score, rnd);
  let phase = phaseFor(done, c);
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = askPhase(ctx, st, phase, pre, rnd);
    if (s) return s;
    phase = phase === 'tech' ? 'behavioral' : phase === 'behavioral' ? 'managerial' : phase === 'managerial' ? 'project' : 'tech';
  }
  return { kind: 'wrapup', prompt: `${pre}That covers what I wanted to ask. Do you have any questions for me?` };
}

function askPhase(ctx: EngineCtx, st: EngineState, phase: Phase, pre: string, rnd: () => number): NextStep | null {
  const askedText = new Set(st.turns.map(t => t.prompt));
  const unused = (l: string[]) => l.filter(p => ![...askedText].some(a => a.endsWith(p)));
  switch (phase) {
    case 'company': {
      if (!ctx.job) return null;
      return { kind: 'behavioral', prompt: `${pre}Why do you want to join ${ctx.job.company}, and what interests you about this ${ctx.job.title} role?` };
    }
    case 'project': {
      const used = st.turns.filter(t => t.kind === 'project').length;
      const p = ctx.projects[used];
      if (p) {
        const tech = p.tech.slice(0, 3).join(', ');
        const text = used % 2 === 0 && (p.challenges || p.productionIssues)
          ? `Let's talk about ${p.name}. What was the hardest problem or production issue there, and how did you solve it?`
          : `Walk me through ${p.name}: your role, the architecture${tech ? `, and why ${tech}` : ''}.`;
        return { kind: 'project', prompt: pre + text };
      }
      if (used) return null;
      return { kind: 'project', prompt: `${pre}Tell me about the most challenging project you've worked on: the problem, your role and the result.` };
    }
    case 'behavioral': {
      const bank = ctx.questions.filter(q => q.type === 'Behavioral' && !st.askedIds.includes(q.id));
      if (bank.length) { const q = bank[Math.floor(rnd() * bank.length)]; return { kind: 'behavioral', prompt: pre + q.question, questionId: q.id, categoryId: q.categoryId, topicId: q.topicId }; }
      const hr = unused(HR_PROMPTS);
      return hr.length ? { kind: 'behavioral', prompt: pre + hr[Math.floor(rnd() * hr.length)] } : null;
    }
    case 'managerial': {
      const bank = ctx.questions.filter(q => q.type === 'Scenario' && !st.askedIds.includes(q.id));
      if (bank.length && rnd() < 0.5) { const q = bank[Math.floor(rnd() * bank.length)]; return { kind: 'behavioral', prompt: pre + q.question, questionId: q.id, categoryId: q.categoryId, topicId: q.topicId }; }
      const m = unused(MANAGERIAL_PROMPTS);
      return m.length ? { kind: 'behavioral', prompt: pre + m[Math.floor(rnd() * m.length)] } : null;
    }
    default: {
      const cats = techCats(ctx);
      const pool = ctx.questions.filter(q => cats.has(q.categoryId) && q.type !== 'Behavioral');
      const pick = selectQuestion(ctx, st, pool, rnd);
      if (!pick) return null;
      const lead = pick.because ? `You mentioned ${pick.because}. ` : '';
      return { kind: 'question', prompt: pre + lead + pick.q.question, questionId: pick.q.id, categoryId: pick.q.categoryId, topicId: pick.q.topicId, level: st.level };
    }
  }
}

function followupChain(turns: MockTurn[]): number {
  let n = 0;
  for (let i = turns.length - 1; i >= 0 && turns[i].kind === 'followup'; i--) n++;
  return n;
}

/** Natural follow-up for the last answer, or null to move on. */
export function followUpFor(ctx: EngineCtx, last: MockTurn, st: EngineState, rnd: () => number): string | null {
  const e = last.eval!;
  const style = ctx.config.style;
  const q = last.questionId ? ctx.questions.find(x => x.id === last.questionId) : undefined;
  if (last.idk) {
    // "I don't know": respond naturally instead of marking wrong and moving on
    if (style === 'Friendly' && q?.keyPoints?.length && last.kind !== 'followup') return `No problem. Here's a hint: think about ${q.keyPoints[0].toLowerCase()}. What would you say now?`;
    return null;
  }
  const aiFollow = e.followUp;
  if (e.score < 50) {
    if (!e.examples && last.kind !== 'followup') return 'Can you give me a practical example from your project?';
    if (e.missed.length) return `You didn't mention ${e.missed[0].toLowerCase()}. How does that fit in?`;
    return style === 'Friendly' ? null : 'Could you explain that more concretely, step by step?';
  }
  if (e.score < 75) {
    if (e.missed.length && (style !== 'Friendly' || rnd() < 0.6)) return `What about ${e.missed[0].toLowerCase()}? How does that fit in?`;
    if (!e.examples && style === 'Challenging') return 'Where have you used this in a real project?';
    return null;
  }
  // strong answer: go deeper when the interviewer is professional/challenging
  if (style !== 'Friendly') {
    if (aiFollow) return aiFollow;
    const bank = q?.followUps?.find(f => !st.turns.some(t => t.prompt.endsWith(f)));
    if (bank && (style === 'Challenging' || rnd() < 0.5)) return bank;
  }
  return null;
}

function closing(style: MockConfig['style'], first: string) {
  return style === 'Friendly' ? `Thanks ${first}, that was a good conversation. Let's look at your report.` : `Thank you, ${first}. That's the end of the interview. Here is your report.`;
}

const HEDGES = /\b(i think|maybe|probably|not sure|i guess|kind of|sort of|i believe|possibly)\b/gi;
const EXAMPLE = /for example|for instance|e\.g\.|in my (current |last )?(project|company|team|role)|we (used|built|had|implemented)|i (used|built|implemented|worked on|handled)/i;

/** Internal evaluation of an answer. Uses key points from the user's own model answer when available. */
export function evaluateTurn(kind: MockTurnKind, prompt: string, answer: string, durationSec: number, spoken: boolean, q?: Pick<Question, 'answer' | 'keyPoints' | 'question'>, idk = false, aiScore?: number, aiMissed?: string[], aiFeedback?: string[]): TurnEval {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  if (idk || !words.length) {
    return { score: idk ? 10 : 0, correctness: 0, completeness: 0, relevance: 0, communication: idk ? 60 : 0, confidence: idk ? 30 : 0, structure: 0, practical: 0, examples: false, missed: q?.keyPoints?.slice(0, 4) || [], feedback: [idk ? 'You said you don’t know — that’s honest; learn this one next.' : 'No answer captured.'], provider: 'none' };
  }
  const local = q ? evaluateLocally(q, answer, spoken ? durationSec : 0) : null;
  const m = speechMetrics(answer, spoken ? durationSec : 0);
  const qTok = new Set(prompt.toLowerCase().match(/[a-z#+.]{4,}/g) || []);
  const aTok = new Set(answer.toLowerCase().match(/[a-z#+.]{4,}/g) || []);
  let overlap = 0;
  qTok.forEach(w => aTok.has(w) && overlap++);
  const relevance = Math.min(100, 45 + (qTok.size ? (overlap / qTok.size) * 110 : 30));
  let communication = 100;
  communication -= Math.min(30, m.fillers * 4);
  if (m.wpm && (m.wpm > 170 || m.wpm < 90)) communication -= 12;
  if (words.length < 25) communication -= 25;
  if (words.length > 280) communication -= 15;
  const hedges = (answer.match(HEDGES) || []).length;
  const confidence = Math.max(10, 95 - hedges * 12 - (words.length < 20 ? 20 : 0));
  const sentences = answer.split(/[.!?]+\s/).filter(s => s.trim().length > 3).length;
  let structure = sentences >= 2 && sentences <= 10 ? 75 : sentences === 1 ? 45 : 60;
  if (/\b(first|second|then|finally|in short|to summarise|to summarize|because|so that)\b/i.test(answer)) structure += 15;
  structure = Math.min(100, structure);
  const examples = EXAMPLE.test(answer);
  const practical = examples ? 85 : 40;
  const kp = local ? local.covered.length + local.missed.length : 0;
  const completeness = kp ? Math.round((local!.covered.length / kp) * 100) : Math.min(100, Math.round((words.length / 90) * 100));
  const correctness = aiScore ?? (local ? local.score : Math.round(0.5 * relevance + 0.3 * structure + 0.2 * practical));
  const technicalKind = kind === 'question' || (kind === 'followup' && !!q);
  const score = Math.round(technicalKind
    ? 0.45 * correctness + 0.15 * completeness + 0.1 * relevance + 0.1 * communication + 0.1 * practical + 0.1 * structure
    : 0.3 * relevance + 0.25 * communication + 0.2 * structure + 0.15 * practical + 0.1 * confidence);
  const missed = aiMissed?.length ? aiMissed : local?.missed || [];
  const feedback = aiFeedback?.length ? aiFeedback : [
    ...(local?.feedback || []),
    ...(!examples && words.length > 20 ? ['Add a concrete example from your work.'] : []),
    ...(hedges >= 2 ? ['Sound more certain: state the answer, then the reasoning.'] : []),
    ...(words.length > 280 ? ['Answer more concisely: aim for about 60–120 seconds.'] : []),
  ];
  return { score: Math.max(0, Math.min(100, score)), correctness: Math.round(correctness), completeness, relevance: Math.round(relevance), communication: Math.max(0, communication), confidence, structure, practical, examples, missed, feedback: [...new Set(feedback)].slice(0, 5), provider: aiScore !== undefined ? 'ai' : 'none' };
}

const avg = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null);

/** Final report from all evaluated turns. */
export function buildReport(turns: MockTurn[], questions: Question[], categories: Category[], topics: Topic[]): MockReport {
  const qById = new Map(questions.map(q => [q.id, q]));
  const catName = (id?: string) => categories.find(c => c.id === id)?.name || 'General';
  const topName = (id?: string) => topics.find(t => t.id === id)?.name || 'General';
  const answered = turns.filter(t => t.eval && t.kind !== 'wrapup');
  const tech = answered.filter(t => (t.kind === 'question' || t.kind === 'followup') && t.questionId && qById.get(t.questionId)?.type !== 'Behavioral');
  const solving = tech.filter(t => ['Scenario', 'System Design', 'Coding'].includes(qById.get(t.questionId!)?.type || '') || t.kind === 'followup');
  const project = answered.filter(t => t.kind === 'intro' || t.kind === 'project');
  const scores = {
    technical: avg(tech.map(t => t.eval!.score)),
    problemSolving: avg(solving.map(t => Math.round(t.eval!.score * 0.6 + t.eval!.practical * 0.4))),
    communication: avg(answered.map(t => t.eval!.communication)) ?? 0,
    confidence: avg(answered.map(t => t.eval!.confidence)) ?? 0,
    project: avg(project.map(t => t.eval!.score)),
    overall: 0,
  };
  const parts: [number | null, number][] = [[scores.technical, 0.35], [scores.problemSolving, 0.15], [scores.communication, 0.2], [scores.confidence, 0.1], [scores.project, 0.2]];
  const w = parts.filter(([v]) => v !== null).reduce((n, [, x]) => n + x, 0);
  scores.overall = w ? Math.round(parts.filter(([v]) => v !== null).reduce((n, [v, x]) => n + (v as number) * x, 0) / w) : 0;

  const byTopic = new Map<string, number[]>();
  const byCat = new Map<string, number[]>();
  for (const t of tech) {
    if (t.topicId) (byTopic.get(t.topicId) ?? byTopic.set(t.topicId, []).get(t.topicId)!).push(t.eval!.score);
    if (t.categoryId) (byCat.get(t.categoryId) ?? byCat.set(t.categoryId, []).get(t.categoryId)!).push(t.eval!.score);
  }
  const topicScores = [...byTopic].map(([topicId, l]) => ({ topicId, name: topName(topicId), score: avg(l)! })).sort((a, b) => a.score - b.score);
  const catScores = [...byCat].map(([categoryId, l]) => ({ categoryId, name: catName(categoryId), score: avg(l)! }));
  const exampleRate = answered.length ? answered.filter(t => t.eval!.examples).length / answered.length : 0;
  const longAnswers = answered.filter(t => t.answer.split(/\s+/).length > 280).length;

  const strengths: string[] = [];
  topicScores.filter(t => t.score >= 75).slice(-3).reverse().forEach(t => strengths.push(`Strong understanding of ${t.name}`));
  if (exampleRate >= 0.5) strengths.push('Good use of project examples');
  if (scores.communication >= 75) strengths.push('Clear, well-structured communication');
  if (scores.project !== null && scores.project >= 75) strengths.push('Confident explanation of your own work');
  if (scores.confidence >= 80) strengths.push('Answers sounded confident');

  const improvements: string[] = [];
  topicScores.filter(t => t.score < 60).slice(0, 3).forEach(t => improvements.push(`${t.name} explanations`));
  if (scores.communication < 65) improvements.push('Communication structure: answer first, then explain, then an example');
  if (longAnswers >= 2) improvements.push('Giving concise answers');
  if (scores.confidence < 60) improvements.push('Confidence: avoid hedging words like "I think" and "maybe"');
  if (exampleRate < 0.3 && answered.length >= 3) improvements.push('Use concrete examples from your projects');
  if (scores.project !== null && scores.project < 60) improvements.push('Explaining your own projects (practise your project story)');

  const struggled = answered.filter(t => t.eval!.score < 60).map(t => {
    const q = t.questionId ? qById.get(t.questionId) : undefined;
    return {
      prompt: q && t.kind !== 'followup' ? q.question : t.prompt, questionId: t.questionId, missed: t.eval!.missed.slice(0, 5), answer: t.answer,
      betterAnswer: q?.answer ? q.answer.slice(0, 1500) : 'Use a clear structure: one-line answer → how it works / what you did → a concrete example with a result (a number if you have one).',
    };
  });
  return {
    scores, strengths: strengths.slice(0, 5), improvements: improvements.slice(0, 6), struggled,
    weakCategories: catScores.filter(c => c.score < 65).sort((a, b) => a.score - b.score),
    weakTopicIds: topicScores.filter(t => t.score < 60).map(t => t.topicId),
    topicScores, communicationWeak: scores.communication < 65,
  };
}

/** Is the candidate saying they don't know? */
export function isIdk(text: string): boolean {
  return /^\s*(i\s*(do\s*not|don'?t)\s*know|no idea|not sure|pass|skip)\b/i.test(text) && text.trim().split(/\s+/).length <= 8;
}
