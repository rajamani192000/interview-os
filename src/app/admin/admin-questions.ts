import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ImportPreview, ImportRow } from '../core/logic/importer';
import { DIFFICULTIES, Difficulty, Question, QUESTION_TYPES } from '../core/models';
import { AdminService } from '../core/services/admin.service';
import { MasterDataStore } from '../core/services/master-data.service';
import { ToastService } from '../core/services/platform.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

const PAGE = 30;
type Draft = Partial<Question> & { question: string; categoryId: string; topicId: string; keyPointsText?: string; tagsText?: string; followUpsText?: string };

@Component({
  selector: 'app-admin-questions',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Questions" back="/admin">
      <button class="btn" (click)="openImport()">⇪ Import</button>
      <button class="btn" (click)="admin.exportMaster('csv')" [disabled]="!md.allQuestions().length">Export CSV</button>
      <button class="btn primary" (click)="newQ()" [disabled]="!md.categories().length">+ New</button>
    </app-page-header>

    @if (importing()) {
      <section class="card stack" aria-label="Import">
        <div class="row between"><h2 style="margin:0">Import questions</h2><button class="btn ghost sm" (click)="closeImport()">Close</button></div>
        <ol class="small muted" style="margin:0;padding-left:18px"><li>Select file</li><li>Parse & validate</li><li>Preview errors and duplicates</li><li>Confirm → save to Firestore</li></ol>
        <p class="xs muted" style="margin:0">Columns (any order, case-insensitive): <b>question</b>, <b>category</b>, answer, topic, difficulty (Easy/Medium/Hard/Senior), type, tags (comma separated), keyPoints (| separated), followUps (| separated), priority (1–3), explanation, seniority, source. JSON: an array of objects with those keys.</p>
        <div class="row"><input type="file" accept=".csv,.json,.xlsx,text/csv,application/json" (change)="pick($event)" aria-label="Choose file" [disabled]="md.state() === 'loading'" />
          <label class="small row">Duplicates: <select class="input" style="width:auto;min-height:34px" [ngModel]="dupMode()" (ngModelChange)="dupMode.set($event); reparse()"><option value="skip">Skip</option><option value="update">Update existing</option></select></label></div>
        @if (parsing()) { <div class="row"><div class="spinner"></div>Reading file…</div> }
        @if (importErr()) { <div class="banner bad small">{{ importErr() }}</div> }
        @if (preview(); as p) {
          <div class="grid stats">
            <div class="stat"><span class="eyebrow">Rows</span><b>{{ p.counts.total }}</b></div>
            <div class="stat"><span class="eyebrow">Will import</span><b style="color:var(--good)">{{ p.counts.new + p.counts.update }}</b><span class="xs muted">{{ p.counts.new }} new · {{ p.counts.update }} updates</span></div>
            <div class="stat"><span class="eyebrow">Duplicates</span><b style="color:var(--warn)">{{ p.counts.duplicates }}</b></div>
            <div class="stat"><span class="eyebrow">Errors (skipped)</span><b style="color:var(--bad)">{{ p.counts.errors }}</b></div>
          </div>
          @if (p.newCategories.length) { <div class="small">New categories: {{ p.newCategories.join(', ') }}</div> }
          @if (p.newTopics.length) { <div class="small">New topics: {{ p.newTopics.length }}</div> }
          <div class="tabs">@for (f of filters; track f.v) { <button class="chip" [class.on]="rowFilter() === f.v" (click)="rowFilter.set(f.v)">{{ f.label }}</button> }</div>
          <div class="table-wrap" style="max-height:380px;overflow:auto"><table class="table"><thead><tr><th>#</th><th>Status</th><th>Question</th><th>Category / topic</th><th>Issues</th></tr></thead><tbody>
            @for (r of shownRows(); track r.row) {
              <tr><td>{{ r.row }}</td><td><span class="badge {{ badge(r) }}">{{ r.status }}</span></td><td class="small">{{ r.question || '—' }}</td><td class="xs">{{ r.category }} / {{ r.topic }} · {{ r.difficulty }}</td>
                <td class="xs">@for (e of r.errors; track e) { <div style="color:var(--bad)">{{ e }}</div> }@for (w of r.warnings; track w) { <div class="muted">{{ w }}</div> }</td></tr>
            }
          </tbody></table></div>
          @if (progress()) { <div class="small">Saving… {{ progress() }}</div> }
          <button class="btn primary big" (click)="confirmImport(p)" [disabled]="saving() || !(p.counts.new + p.counts.update)">{{ saving() ? 'Importing…' : 'Confirm import of ' + (p.counts.new + p.counts.update) + ' questions' }}</button>
        }
      </section>
    }

    @if (md.state() === 'loading') { <app-loading /> }
    @else if (md.state() === 'error') { <app-error [message]="md.error()" (retry)="md.ensureLoaded(true)" /> }
    @else if (!md.allQuestions().length && !importing()) {
      <app-empty title="No questions yet" text="Import your own questions from CSV, JSON or Excel."><button class="btn primary" (click)="openImport()">Import</button></app-empty>
    } @else {
      <div class="card stack">
        <input class="input" type="search" placeholder="Search" [ngModel]="q()" (ngModelChange)="q.set($event); page.set(0)" aria-label="Search" />
        <div class="grid four">
          <select class="input" [ngModel]="cat()" (ngModelChange)="cat.set($event); page.set(0)" aria-label="Category"><option value="">All categories</option>@for (c of md.allCategories(); track c.id) { <option [value]="c.id">{{ c.name }}{{ c.isArchived ? ' (archived)' : '' }}</option> }</select>
          <select class="input" [ngModel]="diff()" (ngModelChange)="diff.set($event); page.set(0)" aria-label="Difficulty"><option value="">Any difficulty</option>@for (d of difficulties; track d) { <option [value]="d">{{ d }}</option> }</select>
          <select class="input" [ngModel]="state()" (ngModelChange)="state.set($event); page.set(0)" aria-label="State"><option value="live">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option><option value="all">All</option></select>
          <span class="small muted" style="align-self:center">{{ filtered().length }} shown · {{ selected().size }} selected</span>
        </div>
        @if (selected().size) {
          <div class="row card slim" style="background:var(--surface-2)">
            <b class="small">Bulk update {{ selected().size }}:</b>
            <select class="input" style="width:auto" [(ngModel)]="bulk.difficulty"><option value="">difficulty…</option>@for (d of difficulties; track d) { <option [value]="d">{{ d }}</option> }</select>
            <select class="input" style="width:auto" [(ngModel)]="bulk.priority"><option [ngValue]="0">priority…</option><option [ngValue]="1">1</option><option [ngValue]="2">2</option><option [ngValue]="3">3</option></select>
            <input class="input" style="width:160px" [(ngModel)]="bulk.tag" placeholder="add tag" />
            <button class="btn sm primary" (click)="applyBulk()" [disabled]="busy()">Apply</button>
            <button class="btn sm danger" (click)="bulkArchive(true)" [disabled]="busy()">Archive</button>
            <button class="btn sm" (click)="bulkArchive(false)" [disabled]="busy()">Restore</button>
            <button class="btn sm ghost" (click)="clearSel()">Clear</button>
          </div>
        }
      </div>
      <div class="card list" style="padding:4px 12px">
        <label class="list-item check small"><input type="checkbox" [checked]="allOnPage()" (change)="togglePage()" /> Select page</label>
        @for (x of pageItems(); track x.id) {
          <div class="list-item">
            <input type="checkbox" [checked]="selected().has(x.id)" (change)="toggle(x.id)" [attr.aria-label]="'Select ' + x.question" />
            <div class="grow stack" style="gap:2px"><span class="small">{{ x.question }}</span>
              <span class="xs muted">{{ catName(x.categoryId) }} · {{ topicName(x.topicId) }} · {{ x.difficulty }} · P{{ x.priority }}{{ x.isArchived ? ' · archived' : '' }}{{ x.isActive === false ? ' · inactive' : '' }}</span></div>
            <button class="btn sm ghost" (click)="editQ(x)">Edit</button>
          </div>
        }
      </div>
      <div class="row between small"><span class="muted">Page {{ page() + 1 }} / {{ pages() }}</span>
        <span class="row"><button class="btn sm" [disabled]="page() === 0" (click)="page.set(page() - 1)">Previous</button><button class="btn sm" [disabled]="page() + 1 >= pages()" (click)="page.set(page() + 1)">Next</button></span></div>
    }

    @if (draft(); as d) {
      <app-modal [title]="d.id ? 'Edit question' : 'New question'" (closed)="draft.set(null)">
        <div class="field"><label for="qq">Question *</label><textarea id="qq" class="input" rows="3" [(ngModel)]="d.question"></textarea></div>
        <div class="grid two">
          <div class="field"><label for="qc">Category *</label><select id="qc" class="input" [(ngModel)]="d.categoryId" (ngModelChange)="d.topicId = ''">@for (c of md.categories(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></div>
          <div class="field"><label for="qt">Topic *</label><select id="qt" class="input" [(ngModel)]="d.topicId">@for (t of topicsFor(d.categoryId); track t.id) { <option [value]="t.id">{{ t.name }}</option> }</select>
            @if (!topicsFor(d.categoryId).length) { <span class="hint">No topics — create one under Topics.</span> }</div>
          <div class="field"><label for="qd">Difficulty</label><select id="qd" class="input" [(ngModel)]="d.difficulty">@for (x of difficulties; track x) { <option [value]="x">{{ x }}</option> }</select></div>
          <div class="field"><label for="qy">Interview type</label><select id="qy" class="input" [(ngModel)]="d.type">@for (x of types; track x) { <option [value]="x">{{ x }}</option> }</select></div>
          <div class="field"><label for="qs">Seniority</label><select id="qs" class="input" [(ngModel)]="d.seniority"><option [ngValue]="undefined">—</option><option>Junior</option><option>Mid</option><option>Senior</option><option>Lead</option></select></div>
          <div class="field"><label for="qp">Priority</label><select id="qp" class="input" [(ngModel)]="d.priority"><option [ngValue]="1">1 · must know</option><option [ngValue]="2">2 · important</option><option [ngValue]="3">3 · optional</option></select></div>
        </div>
        <div class="field"><label for="qa">Answer</label><textarea id="qa" class="input" rows="8" [(ngModel)]="d.answer"></textarea></div>
        <div class="field"><label for="qe">Explanation</label><textarea id="qe" class="input" rows="2" [(ngModel)]="d.explanation"></textarea></div>
        <div class="field"><label for="qk">Key points (one per line; empty = derived from answer bullets)</label><textarea id="qk" class="input" rows="3" [(ngModel)]="d.keyPointsText"></textarea></div>
        <div class="field"><label for="qf">Follow-up questions (one per line)</label><textarea id="qf" class="input" rows="2" [(ngModel)]="d.followUpsText"></textarea></div>
        <div class="field"><label for="qg">Tags (comma separated)</label><input id="qg" class="input" [(ngModel)]="d.tagsText" /></div>
        <label class="check small"><input type="checkbox" [(ngModel)]="d.isActive" /> Active</label>
        @if (err()) { <div class="banner bad small">{{ err() }}</div> }
        <div class="row between">
          @if (d.id) { <button class="btn sm {{ d.isArchived ? '' : 'danger' }}" (click)="archiveOne(d)">{{ d.isArchived ? 'Restore' : 'Archive' }}</button> } @else { <span></span> }
          <span class="row"><button class="btn" (click)="draft.set(null)">Cancel</button><button class="btn primary" (click)="saveQ(d)" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button></span>
        </div>
      </app-modal>
    }
  </div>`,
})
export class AdminQuestionsComponent implements OnInit {
  md = inject(MasterDataStore);
  admin = inject(AdminService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  difficulties = DIFFICULTIES;
  types = QUESTION_TYPES;
  filters = [{ v: 'all', label: 'All' }, { v: 'ok', label: 'Will import' }, { v: 'dup', label: 'Duplicates' }, { v: 'error', label: 'Errors' }, { v: 'warn', label: 'Warnings' }];
  q = signal('');
  cat = signal('');
  diff = signal('');
  state = signal<'live' | 'inactive' | 'archived' | 'all'>('live');
  page = signal(0);
  selected = signal(new Set<string>());
  draft = signal<Draft | null>(null);
  busy = signal(false);
  err = signal('');
  bulk = { difficulty: '' as Difficulty | '', priority: 0, tag: '' };
  // import
  importing = signal(false);
  parsing = signal(false);
  saving = signal(false);
  importErr = signal('');
  preview = signal<ImportPreview | null>(null);
  dupMode = signal<'skip' | 'update'>('skip');
  rowFilter = signal('all');
  progress = signal('');
  private raw: Record<string, unknown>[] = [];

  filtered = computed(() => {
    const t = this.q().toLowerCase();
    return this.md.allQuestions().filter(x =>
      (!this.cat() || x.categoryId === this.cat()) && (!this.diff() || x.difficulty === this.diff()) &&
      (this.state() === 'all' || (this.state() === 'archived' ? x.isArchived : this.state() === 'inactive' ? !x.isArchived && x.isActive === false : !x.isArchived && x.isActive !== false)) &&
      (!t || x.question.toLowerCase().includes(t) || x.tags.some(g => g.includes(t))));
  });
  pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE)));
  pageItems = computed(() => this.filtered().slice(this.page() * PAGE, (this.page() + 1) * PAGE));
  allOnPage = computed(() => this.pageItems().length > 0 && this.pageItems().every(x => this.selected().has(x.id)));
  shownRows = computed(() => {
    const p = this.preview();
    if (!p) return [];
    const f = this.rowFilter();
    return p.rows.filter(r => f === 'all' || (f === 'ok' && (r.status === 'new' || r.status === 'update')) || (f === 'dup' && r.status.startsWith('duplicate')) || (f === 'error' && r.status === 'error') || (f === 'warn' && r.warnings.length)).slice(0, 500);
  });
  catName = (id: string) => this.md.categoryMap().get(id)?.name ?? '—';
  topicName = (id: string) => this.md.topicMap().get(id)?.name ?? '—';
  topicsFor = (cid: string) => this.md.topics().filter(t => t.categoryId === cid);
  badge = (r: ImportRow) => (r.status === 'error' ? 'bad' : r.status.startsWith('duplicate') ? 'warn' : 'good');

  ngOnInit() {
    this.md.ensureLoaded(true).catch(() => undefined);
    if (this.route.snapshot.queryParamMap.get('import')) this.openImport();
  }
  clearSel() { this.selected.set(new Set()); }
  toggle(id: string) { const s = new Set(this.selected()); if (s.has(id)) s.delete(id); else s.add(id); this.selected.set(s); }
  togglePage() { const s = new Set(this.selected()); const all = this.allOnPage(); this.pageItems().forEach(x => (all ? s.delete(x.id) : s.add(x.id))); this.selected.set(s); }

  newQ() {
    const c = this.cat() || this.md.categories()[0]?.id || '';
    this.err.set('');
    this.draft.set({ question: '', answer: '', categoryId: c, topicId: this.topicsFor(c)[0]?.id || '', difficulty: 'Medium', type: 'Concept', priority: 2, isActive: true, keyPointsText: '', tagsText: '', followUpsText: '' });
  }
  editQ(x: Question) {
    this.err.set('');
    this.draft.set({ ...x, keyPointsText: x.keyPoints.join('\n'), tagsText: x.tags.join(', '), followUpsText: x.followUps.join('\n') });
  }
  async saveQ(d: Draft) {
    this.err.set('');
    if (d.question.trim().length < 8) return this.err.set('Question text is required (8+ characters).');
    if (!d.categoryId || !d.topicId) return this.err.set('Category and topic are required.');
    this.busy.set(true);
    try {
      const { keyPointsText, tagsText, followUpsText, ...q } = d;
      await this.admin.saveQuestion({ ...q, keyPoints: (keyPointsText || '').split('\n').map(s => s.trim()).filter(Boolean), tags: (tagsText || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean), followUps: (followUpsText || '').split('\n').map(s => s.trim()).filter(Boolean) });
      this.draft.set(null);
      this.toast.good('Question saved');
    } catch (e) { this.err.set(errorMessage(e)); } finally { this.busy.set(false); }
  }
  async archiveOne(d: Draft) {
    try { await this.admin.setArchived('questions', d.id!, !d.isArchived); this.draft.set(null); } catch (e) { this.err.set(errorMessage(e)); }
  }
  async applyBulk() {
    const ids = [...this.selected()];
    if (!this.bulk.difficulty && !this.bulk.priority && !this.bulk.tag.trim()) { this.toast.bad('Choose something to change.'); return; }
    this.busy.set(true);
    try {
      for (const id of ids) {
        const x = this.md.questionMap().get(id)!;
        await this.admin.saveQuestion({ ...x, difficulty: this.bulk.difficulty || x.difficulty, priority: this.bulk.priority || x.priority, tags: this.bulk.tag.trim() ? [...new Set([...x.tags, this.bulk.tag.trim().toLowerCase()])] : x.tags });
      }
      this.toast.good(`Updated ${ids.length} questions`);
      this.selected.set(new Set());
      this.bulk = { difficulty: '', priority: 0, tag: '' };
    } catch (e) { this.toast.bad(errorMessage(e)); } finally { this.busy.set(false); }
  }
  async bulkArchive(archived: boolean) {
    this.busy.set(true);
    try { for (const id of this.selected()) await this.admin.setArchived('questions', id, archived); this.selected.set(new Set()); this.toast.good(archived ? 'Archived' : 'Restored'); }
    catch (e) { this.toast.bad(errorMessage(e)); } finally { this.busy.set(false); }
  }

  // ---- import ----
  openImport() { this.importing.set(true); this.preview.set(null); this.importErr.set(''); }
  closeImport() { this.importing.set(false); this.preview.set(null); this.raw = []; }
  async pick(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.parsing.set(true); this.importErr.set(''); this.preview.set(null);
    try {
      await this.md.ensureLoaded(); // duplicates are checked against the current bank
      this.raw = await this.admin.parseFile(f);
      if (!this.raw.length) throw new Error('The file has no data rows.');
      if (this.raw.length > 5000) throw new Error('Import at most 5000 rows at a time.');
      this.reparse();
    } catch (e) { this.importErr.set('Could not read the file: ' + errorMessage(e)); }
    finally { this.parsing.set(false); }
  }
  reparse() { if (this.raw.length) this.preview.set(this.admin.preview(this.raw, this.dupMode())); }
  async confirmImport(p: ImportPreview) {
    this.saving.set(true); this.importErr.set('');
    try {
      const r = await this.admin.commitImport(p, (d, t) => this.progress.set(`${d}/${t} writes`));
      this.toast.good(`Imported: ${r.created} new, ${r.updated} updated, ${r.categories} categories, ${r.topics} topics`);
      this.closeImport();
    } catch (e) { this.importErr.set('Import failed — nothing after the last completed batch was saved: ' + errorMessage(e)); }
    finally { this.saving.set(false); this.progress.set(''); }
  }
}
