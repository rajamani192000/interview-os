import { Attempt, Category, Question, RevisionSchedule, Topic } from '../models';

export type Coverage = 'Covered' | 'Partially covered' | 'Needs preparation';
export interface SkillCoverage {
  skill: string;
  coverage: Coverage;
  related: number; // questions in your bank for this skill
  practised: number;
  strong: number;
  avgScore: number | null;
  questionIds: string[]; // suggested to practise next (weakest / unpractised first)
  note: string;
}

/** Known skill vocabulary. Each entry: display name → pattern used to find it in a JD and in questions. */
export const SKILLS: [string, RegExp][] = [
  ['C#', /\bc#|c sharp\b/i],
  ['.NET Core / ASP.NET Core', /\.net\s*(core|\d)|asp\.?net|dotnet/i],
  ['Web API / REST', /web\s*api|rest(ful)?\b|http api/i],
  ['Entity Framework', /entity\s*framework|\bef\s*core\b|\bef\b/i],
  ['LINQ', /\blinq\b/i],
  ['Dependency Injection', /dependency injection|\bdi\b|ioc/i],
  ['Middleware', /middleware/i],
  ['Authentication / JWT', /\bjwt\b|oauth|authenticat|authoriz|identity server|openid/i],
  ['Microservices', /micro-?services?/i],
  ['Design patterns', /design pattern|repository pattern|factory|singleton|cqrs|mediator/i],
  ['SOLID / OOP', /\bsolid\b|\boop\b|object[- ]oriented/i],
  ['Async / multithreading', /async|await|multi-?thread|task parallel|concurren/i],
  ['Angular', /angular/i],
  ['TypeScript', /typescript|\bts\b/i],
  ['RxJS', /rxjs|observable/i],
  ['NgRx / state management', /ngrx|state management|signals?\b/i],
  ['JavaScript', /javascript|\bes6\b|\bjs\b/i],
  ['HTML / CSS', /\bhtml5?\b|\bcss3?\b|scss|sass|bootstrap|tailwind/i],
  ['SQL Server', /sql server|t-?sql|mssql/i],
  ['SQL queries', /\bsql\b|stored procedure|joins?\b|indexes|indexing|query optimi/i],
  ['NoSQL', /nosql|mongo|cosmos|dynamo|redis|firestore/i],
  ['Caching', /cach(e|ing)|redis/i],
  ['Messaging / queues', /rabbitmq|kafka|service bus|message queue|event[- ]driven/i],
  ['Azure', /\bazure\b/i],
  ['AWS', /\baws\b|amazon web services/i],
  ['Docker / containers', /docker|kubernetes|\bk8s\b|\baks\b|\beks\b|containeri[sz]|container (image|registry|orchestration)/i],
  ['CI/CD', /ci\/cd|\bci\b|pipelines?|github actions|azure devops|jenkins/i],
  ['Git', /\bgit\b|github|gitlab|bitbucket/i],
  ['Unit testing', /unit test|xunit|nunit|mstest|jasmine|karma|jest|\btdd\b|moq/i],
  ['System design / architecture', /system design|architect|scalab|high availability|distributed/i],
  ['Performance', /performance|optimi[sz]/i],
  ['Security', /security|owasp|xss|csrf|sql injection/i],
  ['Agile / Scrum', /agile|scrum|kanban|jira/i],
  ['Leadership / mentoring', /mentor|lead(ing)? (a )?team|code review|team lead/i],
  ['Communication', /communication skills|stakeholder|client[- ]facing/i],
];

export function extractSkills(jd: string): string[] {
  const text = jd || '';
  return SKILLS.filter(([, re]) => re.test(text)).map(([n]) => n);
}

/** Maps a JD to coverage using only the user's own question bank, attempts and schedules. */
export function mapJd(jd: string, questions: Question[], topics: Topic[], categories: Category[], schedules: RevisionSchedule[], attempts: Attempt[], extraSkills: string[] = []): SkillCoverage[] {
  const skills = [...new Set([...extractSkills(jd), ...extraSkills])];
  const tName = new Map(topics.map(t => [t.id, t.name]));
  const cName = new Map(categories.map(c => [c.id, c.name]));
  const sched = new Map(schedules.map(s => [s.questionId, s]));
  const scoreBy = new Map<string, number[]>();
  for (const a of attempts) (scoreBy.get(a.questionId) ?? scoreBy.set(a.questionId, []).get(a.questionId)!).push(a.score);
  return skills.map(skill => {
    const re = SKILLS.find(([n]) => n === skill)?.[1] ?? new RegExp(skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const related = questions.filter(q => re.test(q.question) || re.test(tName.get(q.topicId) || '') || re.test(cName.get(q.categoryId) || '') || q.tags.some(t => re.test(t)));
    const practised = related.filter(q => sched.has(q.id));
    const strong = practised.filter(q => ['Strong', 'Mastered'].includes(sched.get(q.id)!.status));
    const scores = related.flatMap(q => (scoreBy.get(q.id) || []).slice(-2));
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    let coverage: Coverage = 'Needs preparation';
    let note: string;
    if (!related.length) note = 'No questions in your bank for this skill yet. Add some via Admin → Import.';
    else if (!practised.length) note = `${related.length} question(s) in your bank, none practised yet.`;
    else {
      const strongRatio = strong.length / related.length;
      if ((strongRatio >= 0.6 && (avg ?? 0) >= 65) || (practised.length >= 3 && (avg ?? 0) >= 80 && strongRatio >= 0.4)) coverage = 'Covered';
      else coverage = 'Partially covered';
      note = `${practised.length}/${related.length} practised, ${strong.length} strong${avg !== null ? `, avg score ${avg}` : ''}.`;
    }
    const order = [...related].sort((a, b) => rank(sched.get(a.id)) - rank(sched.get(b.id)) || a.priority - b.priority);
    return { skill, coverage, related: related.length, practised: practised.length, strong: strong.length, avgScore: avg, questionIds: order.slice(0, 10).map(q => q.id), note };
  });
}

function rank(s?: RevisionSchedule): number {
  if (!s) return 1;
  return s.status === 'Weak' ? 0 : s.status === 'Learning' ? 2 : s.status === 'Strong' ? 3 : 4;
}
