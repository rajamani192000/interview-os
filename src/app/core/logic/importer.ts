import { DIFFICULTIES, Difficulty, Question, QUESTION_TYPES, QuestionType } from '../models';
import { hashText, normalizeText, similarity } from '../util';

export interface ImportRow {
  row: number; // 1-based row in source
  question: string;
  answer: string;
  category: string;
  topic: string;
  difficulty: Difficulty;
  type: QuestionType;
  tags: string[];
  keyPoints: string[];
  followUps: string[];
  priority: number;
  source?: string;
  sourceId?: string;
  explanation?: string;
  seniority?: string;
  hash: string;
  errors: string[];
  warnings: string[];
  status: 'new' | 'update' | 'duplicate-existing' | 'duplicate-in-file' | 'error';
  existingId?: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  counts: { total: number; valid: number; new: number; update: number; duplicates: number; errors: number; warnings: number };
  newCategories: string[];
  newTopics: { category: string; topic: string }[];
}

const ALIASES: Record<string, string[]> = {
  question: ['question', 'q', 'questiontext', 'title', 'prompt'],
  answer: ['answer', 'a', 'modelanswer', 'solution', 'explanation'],
  category: ['category', 'cat', 'subject', 'area', 'skill'],
  topic: ['topic', 'subtopic', 'section', 'module'],
  difficulty: ['difficulty', 'level', 'seniority'],
  type: ['type', 'questiontype', 'kind'],
  tags: ['tags', 'tag', 'keywords', 'labels'],
  keyPoints: ['keypoints', 'points', 'mustmention', 'key_points'],
  followUps: ['followups', 'followup', 'follow_ups', 'crossquestions'],
  priority: ['priority', 'tier', 'importance'],
  core: ['core', 'mustknow'],
  source: ['source', 'reference', 'origin'],
  sourceId: ['id', 'sourceid', 'externalid', 'questionid', 'code'],
  explanation: ['explanation', 'notes', 'why'],
  seniority: ['seniority', 'experiencelevel'],
};

function pick(obj: Record<string, unknown>, field: keyof typeof ALIASES): unknown {
  const keys = Object.keys(obj);
  for (const alias of ALIASES[field]) {
    const k = keys.find(k => k.toLowerCase().replace(/[\s_-]/g, '') === alias.replace(/_/g, ''));
    if (k !== undefined && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function list(v: unknown, commas = false): string[] {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (v === undefined || v === null) return [];
  return String(v).split(commas ? /[|;\n,]/ : /[|;\n]/).map(s => s.trim()).filter(Boolean);
}

/** Derives key points from bullet lines in the answer when none were supplied. */
export function deriveKeyPoints(answer: string): string[] {
  const bullets = (answer || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^([•\-*–]|\d+[.)])\s+/.test(l))
    .map(l => l.replace(/^([•\-*–]|\d+[.)])\s+/, '').split(/\s[–-]\s|:\s/)[0].trim())
    .filter(l => l.length > 2 && l.length < 90);
  return [...new Set(bullets)].slice(0, 8);
}

function toDifficulty(v: unknown, warn: string[]): Difficulty {
  if (v === undefined) return 'Medium';
  const s = String(v).trim().toLowerCase();
  const hit = DIFFICULTIES.find(d => d.toLowerCase() === s);
  if (hit) return hit;
  if (/beginner|basic|junior|low/.test(s)) return 'Easy';
  if (/intermediate|mid/.test(s)) return 'Medium';
  if (/advanced|difficult|high/.test(s)) return 'Hard';
  if (/senior|lead|architect|expert/.test(s)) return 'Senior';
  warn.push(`Unknown difficulty "${v}" – using Medium`);
  return 'Medium';
}

function toType(v: unknown, category: string): QuestionType {
  const s = String(v ?? '').trim().toLowerCase();
  const hit = QUESTION_TYPES.find(t => t.toLowerCase() === s);
  if (hit) return hit;
  if (/code|coding|program/.test(s) || /^coding$/i.test(category)) return 'Coding';
  if (/design|architect/.test(s) || /architecture|system design/i.test(category)) return 'System Design';
  if (/hr|behav/.test(s)) return 'Behavioral';
  if (/scenario|situation/.test(s)) return 'Scenario';
  return 'Concept';
}

export function normalizeRow(raw: Record<string, unknown>, row: number): ImportRow {
  const errors: string[] = [], warnings: string[] = [];
  const question = String(pick(raw, 'question') ?? '').trim();
  const answer = String(pick(raw, 'answer') ?? '').trim();
  const category = String(pick(raw, 'category') ?? '').trim();
  let topic = String(pick(raw, 'topic') ?? '').trim();
  if (!question) errors.push('Question text is missing');
  else if (question.length < 8) errors.push('Question text is too short');
  if (question.length > 2000) errors.push('Question text is longer than 2000 characters');
  if (!category) errors.push('Category is missing');
  if (!answer) warnings.push('No answer – practice will show "no model answer"');
  if (answer.length > 20000) errors.push('Answer is longer than 20000 characters');
  if (!topic) { topic = 'General'; if (category) warnings.push('No topic – filed under "General"'); }
  const pr = pick(raw, 'priority');
  const core = pick(raw, 'core');
  let priority = pr !== undefined ? Number(pr) : core === true || String(core).toLowerCase() === 'true' ? 1 : 3;
  if (!Number.isFinite(priority) || priority < 1) priority = 3;
  priority = Math.min(3, Math.round(priority));
  const keyPoints = list(pick(raw, 'keyPoints'));
  return {
    row,
    question,
    answer,
    category,
    topic,
    difficulty: toDifficulty(pick(raw, 'difficulty'), warnings),
    type: toType(pick(raw, 'type'), category),
    tags: list(pick(raw, 'tags'), true).map(t => t.toLowerCase()).slice(0, 20),
    keyPoints: keyPoints.length ? keyPoints : deriveKeyPoints(answer),
    followUps: list(pick(raw, 'followUps')),
    priority,
    source: pick(raw, 'source') !== undefined ? String(pick(raw, 'source')) : undefined,
    sourceId: pick(raw, 'sourceId') !== undefined ? String(pick(raw, 'sourceId')).slice(0, 60) : undefined,
    explanation: pick(raw, 'explanation') !== undefined ? String(pick(raw, 'explanation')) : undefined,
    seniority: ['Junior', 'Mid', 'Senior', 'Lead'].find(x => x.toLowerCase() === String(pick(raw, 'seniority') ?? '').toLowerCase()),
    hash: hashText(question),
    errors,
    warnings,
    status: errors.length ? 'error' : 'new',
  };
}

/** Parses JSON text: array of objects, or {questions:[...]} */
export function parseJson(text: string): Record<string, unknown>[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : null;
  if (!arr) throw new Error('JSON must be an array of questions or an object with a "questions" array');
  return arr.filter((x: unknown) => x && typeof x === 'object');
}

/** Converts a header row + data rows (CSV or Excel) into objects. */
export function rowsToObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h ?? '').trim());
  return rows
    .slice(1)
    .filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] === null || r[i] === undefined ? undefined : typeof r[i] === 'string' ? (r[i] as string) : r[i]])));
}

export function buildPreview(raw: Record<string, unknown>[], existing: Pick<Question, 'id' | 'question' | 'hash' | 'categoryId'>[], existingCategories: { id: string; name: string }[], existingTopics: { categoryId: string; name: string }[], mode: 'skip' | 'update' = 'skip'): ImportPreview {
  const rows = raw.map((r, i) => normalizeRow(r, i + 1));
  const byHash = new Map(existing.map(q => [q.hash || hashText(q.question), q]));
  const seen = new Map<string, number>();
  const catNames = new Map(existingCategories.map(c => [c.name.toLowerCase(), c.id]));
  const existingNorm = existing.map(q => ({ id: q.id, n: q.question, cat: q.categoryId }));
  for (const r of rows) {
    if (r.status === 'error') continue;
    if (seen.has(r.hash)) { r.status = 'duplicate-in-file'; r.warnings.push(`Same question as row ${seen.get(r.hash)}`); continue; }
    seen.set(r.hash, r.row);
    let hit = byHash.get(r.hash);
    if (!hit) {
      // fuzzy: very similar wording inside the same category
      const catId = catNames.get(r.category.toLowerCase());
      const n = normalizeText(r.question);
      const f = existingNorm.find(e => (!catId || e.cat === catId) && n.length > 20 && similarity(e.n, r.question) >= 0.85);
      if (f) hit = existing.find(e => e.id === f.id);
    }
    if (hit) {
      r.existingId = hit.id;
      r.status = mode === 'update' ? 'update' : 'duplicate-existing';
    }
  }
  const newCategories = [...new Set(rows.filter(r => r.status === 'new' || r.status === 'update').map(r => r.category))].filter(c => !catNames.has(c.toLowerCase()));
  const topicKey = new Set(existingTopics.map(t => `${t.categoryId}|${t.name.toLowerCase()}`));
  const nt = new Map<string, { category: string; topic: string }>();
  for (const r of rows) {
    if (r.status !== 'new' && r.status !== 'update') continue;
    const cid = catNames.get(r.category.toLowerCase());
    if (!cid || !topicKey.has(`${cid}|${r.topic.toLowerCase()}`)) nt.set(`${r.category.toLowerCase()}|${r.topic.toLowerCase()}`, { category: r.category, topic: r.topic });
  }
  const counts = {
    total: rows.length,
    valid: rows.filter(r => r.status !== 'error').length,
    new: rows.filter(r => r.status === 'new').length,
    update: rows.filter(r => r.status === 'update').length,
    duplicates: rows.filter(r => r.status === 'duplicate-existing' || r.status === 'duplicate-in-file').length,
    errors: rows.filter(r => r.status === 'error').length,
    warnings: rows.filter(r => r.warnings.length).length,
  };
  return { rows, counts, newCategories, newTopics: [...nt.values()] };
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns || [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : Array.isArray(v) ? v.join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
}
