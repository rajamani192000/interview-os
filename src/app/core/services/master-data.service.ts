import { computed, inject, Injectable, signal } from '@angular/core';
import { DATA_STORE } from '../data/store';
import { kv } from '../data/kv';
import { Category, Question, Topic } from '../models';
import { LoadState } from './user.service';

interface Cache { version: number; categories: Category[]; topics: Topic[]; questions: Question[]; }
const KEY = 'master.cache.v1';

/**
 * Master data (categories, topics, questions) is global and read-only for users.
 * Cost control: it is cached on the device (IndexedDB) and re-downloaded only when
 * meta/masterData.version changes (1 document read per app open when nothing changed).
 */
@Injectable({ providedIn: 'root' })
export class MasterDataStore {
  private store = inject(DATA_STORE);
  readonly allCategories = signal<Category[]>([]);
  readonly allTopics = signal<Topic[]>([]);
  readonly allQuestions = signal<Question[]>([]);
  readonly version = signal(0);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  readonly fromCache = signal(false);
  private pending: Promise<void> | null = null;

  readonly categories = computed(() => this.allCategories().filter(live).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)));
  readonly topics = computed(() => this.allTopics().filter(live).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)));
  readonly questions = computed(() => {
    const cats = new Set(this.categories().map(c => c.id));
    const tops = new Set(this.topics().map(t => t.id));
    return this.allQuestions().filter(q => live(q) && cats.has(q.categoryId) && tops.has(q.topicId));
  });
  readonly questionMap = computed(() => new Map(this.allQuestions().map(q => [q.id, q])));
  readonly categoryMap = computed(() => new Map(this.allCategories().map(c => [c.id, c])));
  readonly topicMap = computed(() => new Map(this.allTopics().map(t => [t.id, t])));

  ensureLoaded(force = false): Promise<void> {
    if (!force && this.state() === 'ready') return Promise.resolve();
    if (this.pending) return this.pending;
    this.state.set('loading');
    this.pending = this.load(force).finally(() => (this.pending = null));
    return this.pending;
  }

  private async load(force: boolean) {
    const cached = await kv.get<Cache>(KEY);
    let serverVersion = -1;
    try {
      serverVersion = (await this.store.get<{ version: number }>('meta/masterData'))?.version ?? 0;
    } catch (e) {
      if (cached) { this.apply(cached, true); return; }
      this.error.set('Could not load the question bank. Check your connection and try again.');
      this.state.set('error');
      throw e;
    }
    if (!force && cached && cached.version === serverVersion && serverVersion > 0) { this.apply(cached, true); return; }
    try {
      const [categories, topics, questions] = await Promise.all([
        this.store.list<Category>('categories'),
        this.store.list<Topic>('topics'),
        this.store.list<Question>('questions'),
      ]);
      const c: Cache = { version: serverVersion, categories, topics, questions };
      await kv.set(KEY, c);
      this.apply(c, false);
    } catch (e) {
      if (cached) { this.apply(cached, true); return; }
      this.error.set('Could not load the question bank. Check your connection and try again.');
      this.state.set('error');
      throw e;
    }
  }

  private apply(c: Cache, fromCache: boolean) {
    this.allCategories.set(c.categories);
    this.allTopics.set(c.topics);
    this.allQuestions.set(c.questions);
    this.version.set(c.version);
    this.fromCache.set(fromCache);
    this.state.set('ready');
  }

  /** Called by AdminService after writes so admins see changes immediately. */
  async replaceLocal(fn: (c: Cache) => Cache) {
    const next = fn({ version: this.version(), categories: this.allCategories(), topics: this.allTopics(), questions: this.allQuestions() });
    await kv.set(KEY, next);
    this.apply(next, false);
  }

  clearCache() {
    return kv.del(KEY);
  }
}

function live(x: { isActive: boolean; isArchived: boolean }) {
  return x.isActive !== false && !x.isArchived;
}

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private md = inject(MasterDataStore);
  readonly list = this.md.categories;
  readonly all = this.md.allCategories;
  get(id: string) { return this.md.categoryMap().get(id); }
  name(id: string) { return this.get(id)?.name ?? '—'; }
}

@Injectable({ providedIn: 'root' })
export class TopicService {
  private md = inject(MasterDataStore);
  readonly list = this.md.topics;
  readonly all = this.md.allTopics;
  get(id: string) { return this.md.topicMap().get(id); }
  name(id: string) { return this.get(id)?.name ?? '—'; }
  forCategory(categoryId: string) { return this.list().filter(t => t.categoryId === categoryId); }
}

export interface QuestionFilter {
  text?: string;
  categoryId?: string;
  topicId?: string;
  difficulty?: string;
  type?: string;
  priority?: number;
  ids?: Set<string>;
}

@Injectable({ providedIn: 'root' })
export class QuestionService {
  private md = inject(MasterDataStore);
  readonly list = this.md.questions;
  readonly state = this.md.state;
  ensureLoaded() { return this.md.ensureLoaded(); }
  get(id: string) { return this.md.questionMap().get(id); }
  filter(f: QuestionFilter): Question[] {
    const text = (f.text || '').trim().toLowerCase();
    return this.list().filter(q =>
      (!f.categoryId || q.categoryId === f.categoryId) &&
      (!f.topicId || q.topicId === f.topicId) &&
      (!f.difficulty || q.difficulty === f.difficulty) &&
      (!f.type || q.type === f.type) &&
      (!f.priority || q.priority === f.priority) &&
      (!f.ids || f.ids.has(q.id)) &&
      (!text || q.question.toLowerCase().includes(text) || q.tags.some(t => t.includes(text)) || q.answer.toLowerCase().includes(text)),
    );
  }
}
