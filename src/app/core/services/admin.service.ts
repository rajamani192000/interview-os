import { inject, Injectable } from '@angular/core';
import { BatchOp, DATA_STORE, SERVER_TIME } from '../data/store';
import { buildPreview, deriveKeyPoints, ImportPreview, parseCsv, parseJson, rowsToObjects, toCsv } from '../logic/importer';
import { Category, Question, Topic } from '../models';
import { clean, downloadFile, hashText, slugify } from '../util';
import { AuthService } from './auth.service';
import { MasterDataStore } from './master-data.service';

/**
 * AdminService: master data CRUD (archive instead of delete), import pipeline and app settings.
 * Every write is also enforced server-side by firestore.rules (admins/{uid} must exist).
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  private md = inject(MasterDataStore);

  private audit(create: boolean) {
    const by = this.auth.uid()!;
    return create ? { createdAt: SERVER_TIME, createdBy: by, updatedAt: SERVER_TIME, updatedBy: by } : { updatedAt: SERVER_TIME, updatedBy: by };
  }
  private bump(): BatchOp {
    return { type: 'set', path: 'meta/masterData', data: { version: this.md.version() + 1, updatedAt: SERVER_TIME, updatedBy: this.auth.uid()! } };
  }
  private async commit(ops: BatchOp[]) {
    await this.store.batch([...ops, this.bump()]);
  }
  private local<T extends { id: string }>(list: T[], item: T): T[] {
    const i = list.findIndex(x => x.id === item.id);
    return i < 0 ? [...list, item] : list.map(x => (x.id === item.id ? item : x));
  }
  private stamp<T>(x: T, create: boolean): T {
    const now = Date.now(), by = this.auth.uid()!;
    return { ...x, updatedAt: now, updatedBy: by, ...(create ? { createdAt: now, createdBy: by } : {}) };
  }

  // ---------- categories ----------
  async saveCategory(c: Partial<Category> & { name: string }) {
    const create = !c.id;
    const id = c.id || this.store.newId('categories');
    const prev = this.md.allCategories().find(x => x.id === id);
    const data: Omit<Category, 'id'> = { name: c.name.trim(), slug: slugify(c.name), description: c.description?.trim() || '', order: c.order ?? prev?.order ?? this.md.allCategories().length, isActive: c.isActive ?? prev?.isActive ?? true, isArchived: c.isArchived ?? prev?.isArchived ?? false };
    if (this.md.allCategories().some(x => x.id !== id && x.name.toLowerCase() === data.name.toLowerCase() && !x.isArchived)) throw new Error('A category with this name already exists.');
    await this.commit([{ type: 'set', path: `categories/${id}`, data: clean({ ...data, ...this.audit(create) }), merge: true }]);
    await this.md.replaceLocal(m => ({ ...m, version: m.version + 1, categories: this.local(m.categories, this.stamp({ ...prev, ...data, id } as Category, create)) }));
    return id;
  }

  // ---------- topics ----------
  async saveTopic(t: Partial<Topic> & { name: string; categoryId: string }) {
    const create = !t.id;
    const id = t.id || this.store.newId('topics');
    const prev = this.md.allTopics().find(x => x.id === id);
    const data: Omit<Topic, 'id'> = { name: t.name.trim(), categoryId: t.categoryId, slug: slugify(t.name), order: t.order ?? prev?.order ?? this.md.allTopics().filter(x => x.categoryId === t.categoryId).length, isActive: t.isActive ?? prev?.isActive ?? true, isArchived: t.isArchived ?? prev?.isArchived ?? false };
    if (this.md.allTopics().some(x => x.id !== id && x.categoryId === t.categoryId && x.name.toLowerCase() === data.name.toLowerCase() && !x.isArchived)) throw new Error('This category already has a topic with that name.');
    await this.commit([{ type: 'set', path: `topics/${id}`, data: clean({ ...data, ...this.audit(create) }), merge: true }]);
    await this.md.replaceLocal(m => ({ ...m, version: m.version + 1, topics: this.local(m.topics, this.stamp({ ...prev, ...data, id } as Topic, create)) }));
    return id;
  }

  // ---------- questions ----------
  async saveQuestion(q: Partial<Question> & Pick<Question, 'question' | 'categoryId' | 'topicId'>) {
    const create = !q.id;
    const id = q.id || this.store.newId('questions');
    const prev = this.md.allQuestions().find(x => x.id === id);
    const hash = hashText(q.question);
    const dup = this.md.allQuestions().find(x => x.id !== id && x.hash === hash && !x.isArchived);
    if (dup) throw new Error('This question already exists (same wording).');
    const data: Omit<Question, 'id'> = {
      categoryId: q.categoryId, topicId: q.topicId, question: q.question.trim(), answer: (q.answer || '').trim(),
      keyPoints: q.keyPoints?.length ? q.keyPoints : deriveKeyPoints(q.answer || ''), difficulty: q.difficulty || 'Medium', type: q.type || 'Concept',
      tags: q.tags || [], followUps: q.followUps || [], priority: q.priority || 2, source: q.source || prev?.source || 'Admin',
      isActive: q.isActive ?? prev?.isActive ?? true, isArchived: q.isArchived ?? prev?.isArchived ?? false, hash,
    };
    await this.commit([{ type: 'set', path: `questions/${id}`, data: clean({ ...data, ...this.audit(create) }), merge: true }]);
    await this.md.replaceLocal(m => ({ ...m, version: m.version + 1, questions: this.local(m.questions, this.stamp({ ...prev, ...data, id } as Question, create)) }));
    return id;
  }

  /** Archive/restore instead of delete (keeps users' history valid). */
  async setArchived(kind: 'categories' | 'topics' | 'questions', id: string, archived: boolean) {
    await this.commit([{ type: 'set', path: `${kind}/${id}`, data: { isArchived: archived, ...this.audit(false) }, merge: true }]);
    await this.md.replaceLocal(m => ({ ...m, version: m.version + 1, [kind]: (m[kind] as { id: string }[]).map(x => (x.id === id ? { ...x, isArchived: archived } : x)) }));
  }
  async setActive(kind: 'categories' | 'topics' | 'questions', id: string, active: boolean) {
    await this.commit([{ type: 'set', path: `${kind}/${id}`, data: { isActive: active, ...this.audit(false) }, merge: true }]);
    await this.md.replaceLocal(m => ({ ...m, version: m.version + 1, [kind]: (m[kind] as { id: string }[]).map(x => (x.id === id ? { ...x, isActive: active } : x)) }));
  }

  // ---------- import ----------
  async parseFile(file: File): Promise<Record<string, unknown>[]> {
    const name = file.name.toLowerCase();
    if (file.size > 15 * 1024 * 1024) throw new Error('File is larger than 15 MB.');
    if (name.endsWith('.json')) return parseJson(await file.text());
    if (name.endsWith('.csv') || name.endsWith('.tsv') || file.type === 'text/csv') return rowsToObjects(parseCsv(await file.text()));
    if (name.endsWith('.xlsx')) {
      const { default: readXlsx } = await import('read-excel-file');
      const rows = await readXlsx(file);
      return rowsToObjects(rows as unknown[][]);
    }
    if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. Save as .xlsx or CSV and try again.');
    throw new Error('Unsupported file type. Use .json, .csv or .xlsx.');
  }

  preview(raw: Record<string, unknown>[], mode: 'skip' | 'update'): ImportPreview {
    return buildPreview(raw, this.md.allQuestions().filter(q => !q.isArchived), this.md.allCategories().filter(c => !c.isArchived), this.md.allTopics().filter(t => !t.isArchived), mode);
  }

  /** Writes a confirmed preview: creates missing categories/topics, then questions, in batches. */
  async commitImport(p: ImportPreview, onProgress?: (done: number, total: number) => void): Promise<{ created: number; updated: number; categories: number; topics: number }> {
    const cats = new Map(this.md.allCategories().filter(c => !c.isArchived).map(c => [c.name.toLowerCase(), c.id]));
    const tops = new Map(this.md.allTopics().filter(t => !t.isArchived).map(t => [`${t.categoryId}|${t.name.toLowerCase()}`, t.id]));
    const ops: BatchOp[] = [];
    const newCats: Category[] = [], newTops: Topic[] = [], newQs: Question[] = [];
    let catOrder = this.md.allCategories().length;
    for (const name of p.newCategories) {
      const id = this.store.newId('categories');
      cats.set(name.toLowerCase(), id);
      const c = { name, slug: slugify(name), description: '', order: catOrder++, isActive: true, isArchived: false };
      ops.push({ type: 'set', path: `categories/${id}`, data: { ...c, ...this.audit(true) } });
      newCats.push(this.stamp({ ...c, id }, true));
    }
    const rows = p.rows.filter(r => r.status === 'new' || r.status === 'update');
    for (const r of rows) {
      const cid = cats.get(r.category.toLowerCase())!;
      const key = `${cid}|${r.topic.toLowerCase()}`;
      if (!tops.has(key)) {
        const id = this.store.newId('topics');
        tops.set(key, id);
        const t = { name: r.topic, categoryId: cid, slug: slugify(r.topic), order: newTops.filter(x => x.categoryId === cid).length, isActive: true, isArchived: false };
        ops.push({ type: 'set', path: `topics/${id}`, data: { ...t, ...this.audit(true) } });
        newTops.push(this.stamp({ ...t, id }, true));
      }
      const id = r.existingId || this.store.newId('questions');
      const q = clean({ categoryId: cid, topicId: tops.get(key)!, question: r.question, answer: r.answer, keyPoints: r.keyPoints, difficulty: r.difficulty, type: r.type, tags: r.tags, followUps: r.followUps, priority: r.priority, source: r.source || 'Import', sourceId: r.sourceId, explanation: r.explanation, seniority: r.seniority as Question['seniority'], hash: r.hash, isActive: true, isArchived: false });
      ops.push({ type: 'set', path: `questions/${id}`, data: { ...q, ...this.audit(!r.existingId) }, merge: !!r.existingId });
      newQs.push(this.stamp({ ...q, id } as Question, !r.existingId));
    }
    // batches of 400 writes; version bump in the last one
    const size = 400;
    for (let i = 0; i < ops.length; i += size) {
      const part = ops.slice(i, i + size);
      if (i + size >= ops.length) part.push(this.bump());
      await this.store.batch(part);
      onProgress?.(Math.min(i + size, ops.length), ops.length);
    }
    await this.md.replaceLocal(m => ({
      version: m.version + 1,
      categories: [...m.categories, ...newCats],
      topics: [...m.topics, ...newTops],
      questions: newQs.reduce((l, q) => this.local(l, { ...(l.find(x => x.id === q.id) || {}), ...q } as Question), m.questions),
    }));
    return { created: rows.filter(r => r.status === 'new').length, updated: rows.filter(r => r.status === 'update').length, categories: newCats.length, topics: newTops.length };
  }

  exportMaster(format: 'json' | 'csv') {
    const cat = new Map(this.md.allCategories().map(c => [c.id, c.name]));
    const top = new Map(this.md.allTopics().map(t => [t.id, t.name]));
    const rows = this.md.allQuestions().filter(q => !q.isArchived).map(q => ({ id: q.sourceId || q.id, category: cat.get(q.categoryId), topic: top.get(q.topicId), question: q.question, answer: q.answer, keyPoints: q.keyPoints, difficulty: q.difficulty, type: q.type, tags: q.tags, followUps: q.followUps, priority: q.priority, source: q.source }));
    if (format === 'json') downloadFile('questions-export.json', JSON.stringify(rows, null, 2));
    else downloadFile('questions-export.csv', toCsv(rows), 'text/csv');
  }

  async forceRefresh() {
    await this.store.batch([this.bump()]);
    await this.md.ensureLoaded(true);
  }
}
