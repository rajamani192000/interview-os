import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DEFAULT_TEMPLATES, ReminderTemplates } from '../core/logic/reminders';
import { Category, Topic } from '../core/models';
import { AdminService } from '../core/services/admin.service';
import { AppConfig, AppConfigService } from '../core/services/app-config.service';
import { AuthService } from '../core/services/auth.service';
import { MasterDataStore } from '../core/services/master-data.service';
import { ToastService } from '../core/services/platform.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

@Component({
  selector: 'app-admin-home',
  imports: [RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Admin" subtitle="Master data shared by all users. Writes are enforced by Firestore rules (admins/{uid})." />
    @if (md.state() === 'loading') { <app-loading /> }
    @else if (md.state() === 'error') { <app-error [message]="md.error()" (retry)="md.ensureLoaded(true)" /> }
    @else {
      <div class="grid stats">
        <a class="card slim stat" routerLink="/admin/questions" style="color:var(--text)"><span class="eyebrow">Questions</span><b>{{ live(md.allQuestions()) }}</b><span class="xs muted">{{ archived(md.allQuestions()) }} archived</span></a>
        <a class="card slim stat" routerLink="/admin/categories" style="color:var(--text)"><span class="eyebrow">Categories</span><b>{{ live(md.allCategories()) }}</b><span class="xs muted">{{ archived(md.allCategories()) }} archived</span></a>
        <a class="card slim stat" routerLink="/admin/topics" style="color:var(--text)"><span class="eyebrow">Topics</span><b>{{ live(md.allTopics()) }}</b><span class="xs muted">{{ archived(md.allTopics()) }} archived</span></a>
        <div class="card slim stat"><span class="eyebrow">Master data version</span><b>{{ md.version() }}</b><span class="xs muted">clients re-download when it changes</span></div>
      </div>
      @if (!md.allQuestions().length) {
        <div class="card stack"><h3>Start here: import your questions</h3><p class="small muted" style="margin:0">CSV, JSON or Excel (.xlsx). Categories and topics are created from the file. Nothing is written until you confirm the preview.</p>
          <div><a class="btn primary" routerLink="/admin/questions" [queryParams]="{ import: 1 }">Import questions</a></div></div>
      }
      <div class="grid two">
        <a class="card" routerLink="/admin/questions" style="color:var(--text)"><h3>Questions</h3><p class="small muted" style="margin:0">Create, edit, archive, bulk update, import, export.</p></a>
        <a class="card" routerLink="/admin/categories" style="color:var(--text)"><h3>Categories</h3><p class="small muted" style="margin:0">Names, order, active/archived.</p></a>
        <a class="card" routerLink="/admin/topics" style="color:var(--text)"><h3>Topics</h3><p class="small muted" style="margin:0">Topics inside each category.</p></a>
        <a class="card" routerLink="/admin/settings" style="color:var(--text)"><h3>System settings</h3><p class="small muted" style="margin:0">Revision intervals, defaults, announcement, notification templates.</p></a>
      </div>
    }
  </div>`,
})
export class AdminHomeComponent implements OnInit {
  md = inject(MasterDataStore);
  live = (l: { isArchived: boolean }[]) => l.filter(x => !x.isArchived).length;
  archived = (l: { isArchived: boolean }[]) => l.filter(x => x.isArchived).length;
  ngOnInit() { this.md.ensureLoaded(true).catch(() => undefined); }
}

@Component({
  selector: 'app-admin-categories',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Categories" back="/admin"><button class="btn primary" (click)="edit.set({ name: '', description: '', order: md.allCategories().length })">+ New category</button></app-page-header>
    <label class="check small"><input type="checkbox" [ngModel]="showArchived()" (ngModelChange)="showArchived.set($event)" /> Show archived</label>
    @if (!list().length) { <app-empty title="No categories" text="Create one, or import questions and categories will be created automatically." /> }
    <div class="card list" style="padding:4px 12px">
      @for (c of list(); track c.id) {
        <div class="list-item">
          <div class="grow stack" style="gap:0"><b class="small">{{ c.name }}</b><span class="xs muted">order {{ c.order }} · {{ count(c.id) }} questions · {{ topicCount(c.id) }} topics{{ c.isActive === false ? ' · inactive' : '' }}</span></div>
          @if (c.isArchived) { <span class="badge">archived</span> }
          <button class="btn sm ghost" (click)="edit.set({ ...c })">Edit</button>
          <button class="btn sm ghost" (click)="toggleActive(c)">{{ c.isActive === false ? 'Activate' : 'Deactivate' }}</button>
          <button class="btn sm {{ c.isArchived ? '' : 'danger' }}" (click)="archive(c)">{{ c.isArchived ? 'Restore' : 'Archive' }}</button>
        </div>
      }
    </div>
    @if (edit(); as e) {
      <app-modal [title]="e.id ? 'Edit category' : 'New category'" (closed)="edit.set(null)">
        <div class="field"><label for="cn">Name *</label><input id="cn" class="input" [(ngModel)]="e.name" /></div>
        <div class="field"><label for="cd">Description</label><input id="cd" class="input" [(ngModel)]="e.description" /></div>
        <div class="field"><label for="co">Order</label><input id="co" class="input" type="number" [(ngModel)]="e.order" /></div>
        @if (err()) { <div class="banner bad small">{{ err() }}</div> }
        <div class="row" style="justify-content:flex-end"><button class="btn" (click)="edit.set(null)">Cancel</button><button class="btn primary" (click)="save(e)" [disabled]="busy()">Save</button></div>
      </app-modal>
    }
  </div>`,
})
export class AdminCategoriesComponent implements OnInit {
  md = inject(MasterDataStore);
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  showArchived = signal(false);
  edit = signal<Partial<Category> & { name: string } | null>(null);
  busy = signal(false);
  err = signal('');
  list = computed(() => this.md.allCategories().filter(c => this.showArchived() || !c.isArchived).sort((a, b) => a.order - b.order));
  count = (id: string) => this.md.allQuestions().filter(q => q.categoryId === id && !q.isArchived).length;
  topicCount = (id: string) => this.md.allTopics().filter(t => t.categoryId === id && !t.isArchived).length;
  ngOnInit() { this.md.ensureLoaded().catch(() => undefined); }
  async save(e: Partial<Category> & { name: string }) {
    if (!e.name.trim()) { this.err.set('Name is required.'); return; }
    this.busy.set(true); this.err.set('');
    try { await this.admin.saveCategory(e); this.edit.set(null); this.toast.good('Category saved'); } catch (x) { this.err.set(errorMessage(x)); } finally { this.busy.set(false); }
  }
  async archive(c: Category) {
    if (!c.isArchived && this.count(c.id) && !confirm(`Archive "${c.name}"? Its ${this.count(c.id)} questions will be hidden from users (history is kept).`)) return;
    try { await this.admin.setArchived('categories', c.id, !c.isArchived); } catch (x) { this.toast.bad(errorMessage(x)); }
  }
  async toggleActive(c: Category) {
    try { await this.admin.setActive('categories', c.id, c.isActive === false); } catch (x) { this.toast.bad(errorMessage(x)); }
  }
}

@Component({
  selector: 'app-admin-topics',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Topics" back="/admin"><button class="btn primary" (click)="newTopic()" [disabled]="!md.allCategories().length">+ New topic</button></app-page-header>
    <div class="row"><select class="input" style="max-width:280px" [ngModel]="cat()" (ngModelChange)="cat.set($event)" aria-label="Category"><option value="">All categories</option>@for (c of md.categories(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select>
      <label class="check small"><input type="checkbox" [ngModel]="showArchived()" (ngModelChange)="showArchived.set($event)" /> Show archived</label></div>
    @if (!md.allCategories().length) { <app-empty title="Create a category first" /> }
    @else if (!list().length) { <app-empty title="No topics" /> }
    <div class="card list" style="padding:4px 12px">
      @for (t of list(); track t.id) {
        <div class="list-item">
          <div class="grow stack" style="gap:0"><b class="small">{{ t.name }}</b><span class="xs muted">{{ catName(t.categoryId) }} · {{ count(t.id) }} questions{{ t.isActive === false ? ' · inactive' : '' }}</span></div>
          @if (t.isArchived) { <span class="badge">archived</span> }
          <button class="btn sm ghost" (click)="edit.set({ ...t })">Edit</button>
          <button class="btn sm {{ t.isArchived ? '' : 'danger' }}" (click)="archive(t)">{{ t.isArchived ? 'Restore' : 'Archive' }}</button>
        </div>
      }
    </div>
    @if (edit(); as e) {
      <app-modal [title]="e.id ? 'Edit topic' : 'New topic'" (closed)="edit.set(null)">
        <div class="field"><label for="tc">Category *</label><select id="tc" class="input" [(ngModel)]="e.categoryId">@for (c of md.categories(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></div>
        <div class="field"><label for="tn">Name *</label><input id="tn" class="input" [(ngModel)]="e.name" /></div>
        <div class="field"><label for="to">Order</label><input id="to" class="input" type="number" [(ngModel)]="e.order" /></div>
        @if (err()) { <div class="banner bad small">{{ err() }}</div> }
        <div class="row" style="justify-content:flex-end"><button class="btn" (click)="edit.set(null)">Cancel</button><button class="btn primary" (click)="save(e)" [disabled]="busy()">Save</button></div>
      </app-modal>
    }
  </div>`,
})
export class AdminTopicsComponent implements OnInit {
  md = inject(MasterDataStore);
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  cat = signal('');
  showArchived = signal(false);
  edit = signal<Partial<Topic> & { name: string; categoryId: string } | null>(null);
  busy = signal(false);
  err = signal('');
  list = computed(() => this.md.allTopics().filter(t => (!this.cat() || t.categoryId === this.cat()) && (this.showArchived() || !t.isArchived)).sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.order - b.order));
  catName = (id: string) => this.md.categoryMap().get(id)?.name ?? '—';
  count = (id: string) => this.md.allQuestions().filter(q => q.topicId === id && !q.isArchived).length;
  ngOnInit() { this.md.ensureLoaded().catch(() => undefined); }
  newTopic() { this.edit.set({ name: '', categoryId: this.cat() || this.md.categories()[0]?.id || '', order: 0 }); }
  async save(e: Partial<Topic> & { name: string; categoryId: string }) {
    if (!e.name.trim() || !e.categoryId) { this.err.set('Category and name are required.'); return; }
    this.busy.set(true); this.err.set('');
    try { await this.admin.saveTopic(e); this.edit.set(null); this.toast.good('Topic saved'); } catch (x) { this.err.set(errorMessage(x)); } finally { this.busy.set(false); }
  }
  async archive(t: Topic) {
    try { await this.admin.setArchived('topics', t.id, !t.isArchived); } catch (x) { this.toast.bad(errorMessage(x)); }
  }
}

@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    <app-page-header title="System settings" subtitle="Stored in meta/appSettings — readable by users, writable by admins only" back="/admin" />
    @if (!c) { <app-loading /> } @else {
      <section class="card stack">
        <h3>Revision configuration</h3>
        <div class="field"><label for="ld">Interval ladder (days, comma separated)</label><input id="ld" class="input" [(ngModel)]="ladder" /><span class="hint">Default 1, 3, 7, 14, 30, 60. Applies to reviews from now on.</span></div>
        <div class="grid two">
          <div class="field"><label for="dn">Default new questions/day</label><input id="dn" class="input" type="number" min="0" max="20" [(ngModel)]="c.defaultNewPerDay" /></div>
          <div class="field"><label for="dd">Default daily minutes</label><input id="dd" class="input" type="number" min="15" max="300" [(ngModel)]="c.defaultDailyMinutes" /></div>
        </div>
      </section>
      <section class="card stack">
        <h3>Announcement</h3>
        <textarea class="input" rows="2" [(ngModel)]="c.announcement" placeholder="Shown at the top of the app for all users (leave empty for none)"></textarea>
      </section>
      <section class="card stack">
        <h3>Notification templates</h3>
        <p class="xs muted" style="margin:0">Placeholders: {{ '{' }}min{{ '}' }} = minimum minutes, {{ '{' }}days{{ '}' }} = days to interview.</p>
        @for (k of templateKeys; track k) {
          <div class="field"><label [for]="'t' + k">{{ k }}</label><input [id]="'t' + k" class="input" [ngModel]="c.templates[k]" (ngModelChange)="c.templates[k] = $event" /></div>
        }
        <div><button class="btn sm ghost" (click)="c.templates = { ...defaults }">Reset templates</button></div>
      </section>
      <section class="card stack">
        <h3>Cache</h3>
        <p class="small muted" style="margin:0">Users re-download master data only when its version changes. Force a refresh if you edited data directly in the Firebase console.</p>
        <div><button class="btn sm" (click)="refresh()">Bump version & refresh</button></div>
      </section>
      @if (err()) { <div class="banner bad small">{{ err() }}</div> }
      <button class="btn primary big" (click)="save()" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save settings' }}</button>
    }
  </div>`,
})
export class AdminSettingsComponent implements OnInit {
  private config = inject(AppConfigService);
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  c: AppConfig | null = null;
  ladder = '';
  busy = signal(false);
  err = signal('');
  defaults = DEFAULT_TEMPLATES;
  templateKeys = Object.keys(DEFAULT_TEMPLATES) as (keyof ReminderTemplates)[];
  async ngOnInit() {
    await this.config.ensureLoaded(true);
    this.c = structuredClone(this.config.config());
    this.ladder = this.c.ladder.join(', ');
  }
  async save() {
    this.busy.set(true); this.err.set('');
    try {
      await this.config.save({ ...this.c!, ladder: this.ladder.split(',').map(x => Number(x.trim())).filter(n => Number.isFinite(n) && n > 0) }, this.auth.uid()!);
      this.toast.good('System settings saved');
    } catch (e) { this.err.set(errorMessage(e)); } finally { this.busy.set(false); }
  }
  async refresh() {
    try { await this.admin.forceRefresh(); this.toast.good('Master data version bumped'); } catch (e) { this.toast.bad(errorMessage(e)); }
  }
}
