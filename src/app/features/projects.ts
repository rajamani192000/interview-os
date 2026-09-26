import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Note, NoteRef, Project } from '../core/models';
import { InterviewService, JobService, ProjectService } from '../core/services/career.service';
import { MasterDataStore, TopicService } from '../core/services/master-data.service';
import { ToastService } from '../core/services/platform.service';
import { NoteService } from '../core/services/practice.service';
import { errorMessage } from '../core/util';
import { UI } from '../shared/ui';

const FIELDS: { key: keyof Project; label: string; hint: string }[] = [
  { key: 'responsibilities', label: 'Responsibilities', hint: 'What you owned' },
  { key: 'architecture', label: 'Architecture', hint: 'Layers, services, data flow, hosting' },
  { key: 'challenges', label: 'Challenges', hint: 'The hardest technical problems' },
  { key: 'solution', label: 'Solutions', hint: 'How you solved them and why' },
  { key: 'performance', label: 'Performance improvements', hint: 'What you measured and changed' },
  { key: 'productionIssues', label: 'Production issues', hint: 'Incidents you handled (STAR)' },
  { key: 'impact', label: 'Achievements', hint: 'Only real outcomes you can defend in an interview' },
];
const blank = (): Project => ({ name: '', role: '', tech: [], responsibilities: '', architecture: '', problem: '', challenges: '', solution: '', performance: '', productionIssues: '', impact: '', talkingPoints: [], linkedQuestionIds: [] });

@Component({
  selector: 'app-projects',
  imports: [FormsModule, RouterLink, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="My Projects" subtitle="Your real project stories — used in mock interviews and project rounds"><button class="btn primary" (click)="open(null)">+ Add project</button></app-page-header>
    @if (svc.state() === 'loading' && !svc.items().length) { <app-loading /> }
    @else if (svc.state() === 'error') { <app-error [message]="svc.error()" (retry)="svc.ensureLoaded(true)" /> }
    @else if (!svc.items().length) { <app-empty title="No projects yet" text="Interviewers always ask about your projects. Write each one down once, then rehearse it."><button class="btn primary" (click)="open(null)">Add a project</button></app-empty> }
    @for (p of svc.items(); track p.id) {
      <article class="card stack">
        <div class="row between"><div><h3 style="margin:0">{{ p.name }}</h3><span class="small muted">{{ p.role }}</span></div>
          <span class="row"><a class="btn sm" routerLink="/app/communication" [queryParams]="{ type: 'Explain a project' }">Rehearse</a><button class="btn sm" (click)="open(p)">Edit</button></span></div>
        @if (p.tech.length) { <div class="row">@for (t of p.tech; track t) { <span class="badge">{{ t }}</span> }</div> }
        @for (fl of fields; track fl.key) { @if (p[fl.key]) { <div class="small"><b>{{ fl.label }}:</b> <span class="pre">{{ p[fl.key] }}</span></div> } }
        @if (p.talkingPoints.length) { <div class="small"><b>Talking points:</b> {{ p.talkingPoints.join(' · ') }}</div> }
      </article>
    }
    @if (form(); as f) {
      <app-modal [title]="f.id ? 'Edit project' : 'Add project'" (closed)="form.set(null)">
        <div class="grid two">
          <div class="field"><label for="pn">Project name *</label><input id="pn" class="input" [(ngModel)]="f.name" /></div>
          <div class="field"><label for="pr">Your role *</label><input id="pr" class="input" [(ngModel)]="f.role" /></div>
        </div>
        <div class="field"><label for="pt">Technology (comma separated)</label><input id="pt" class="input" [(ngModel)]="tech" /></div>
        @for (fl of fields; track fl.key) {
          <div class="field"><label [for]="'pf' + fl.key">{{ fl.label }}</label><textarea [id]="'pf' + fl.key" class="input" rows="3" [placeholder]="fl.hint" [ngModel]="$any(f)[fl.key]" (ngModelChange)="$any(f)[fl.key] = $event"></textarea></div>
        }
        <div class="field"><label for="tp">Talking points (one per line)</label><textarea id="tp" class="input" rows="3" [(ngModel)]="points"></textarea></div>
        @if (error()) { <div class="banner bad small">{{ error() }}</div> }
        <div class="row between">
          @if (f.id) { <button class="btn danger sm" (click)="remove(f.id)">Delete</button> } @else { <span></span> }
          <span class="row"><button class="btn" (click)="form.set(null)">Cancel</button><button class="btn primary" (click)="save(f)" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button></span>
        </div>
      </app-modal>
    }
  </div>`,
})
export class ProjectsComponent implements OnInit {
  svc = inject(ProjectService);
  private toast = inject(ToastService);
  fields = FIELDS;
  form = signal<(Project & { id?: string }) | null>(null);
  busy = signal(false);
  error = signal('');
  tech = '';
  points = '';
  ngOnInit() { this.svc.ensureLoaded().catch(() => undefined); }
  open(p: (Project & { id?: string }) | null) {
    const f = { ...blank(), ...(p || {}) };
    this.tech = f.tech.join(', ');
    this.points = f.talkingPoints.join('\n');
    this.error.set('');
    this.form.set(f);
  }
  async save(f: Project & { id?: string }) {
    if (!f.name.trim() || !f.role.trim()) { this.error.set('Project name and your role are required.'); return; }
    this.busy.set(true);
    try {
      await this.svc.save({ ...f, name: f.name.trim(), tech: this.tech.split(',').map(s => s.trim()).filter(Boolean), talkingPoints: this.points.split('\n').map(s => s.trim()).filter(Boolean) }, f.id);
      this.form.set(null);
      this.toast.good('Project saved');
    } catch (e) { this.error.set(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async remove(id: string) {
    if (!confirm('Delete this project permanently?')) return;
    try { await this.svc.remove(id); this.form.set(null); } catch (e) { this.error.set(errorMessage(e)); }
  }
}

@Component({
  selector: 'app-notes',
  imports: [FormsModule, RouterLink, DatePipe, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Notes" subtitle="Notes on questions, topics, projects, interviews and jobs"><button class="btn primary" (click)="open(null)">+ New note</button></app-page-header>
    <div class="card stack">
      <input class="input" type="search" placeholder="Search notes" [ngModel]="q()" (ngModelChange)="q.set($event)" aria-label="Search notes" />
      <div class="tabs"><button class="chip" [class.on]="!ref()" (click)="ref.set('')">All</button>
        @for (r of refs; track r) { <button class="chip" [class.on]="ref() === r" (click)="ref.set(r)">{{ r }}</button> }</div>
    </div>
    @if (svc.state() === 'loading' && !svc.items().length) { <app-loading /> }
    @else if (svc.state() === 'error') { <app-error [message]="svc.error()" (retry)="svc.ensureLoaded(true)" /> }
    @else if (!list().length) { <app-empty title="No notes" text="Add notes here or from any question, job or interview." /> }
    @for (n of list(); track n.id) {
      <article class="card stack" style="gap:6px">
        <div class="row between"><b class="small">{{ n.title || 'Note' }}</b><span class="badge">{{ n.refType }}</span></div>
        <div class="pre small">{{ n.body }}</div>
        <div class="row between xs muted"><span>{{ n.updatedAt | date: 'd MMM y, HH:mm' }}</span>
          <span class="row">@if (link(n); as l) { <a [routerLink]="l">Open</a> }<button class="btn ghost sm" (click)="open(n)">Edit</button></span></div>
      </article>
    }
    @if (form(); as f) {
      <app-modal [title]="f.id ? 'Edit note' : 'New note'" (closed)="form.set(null)">
        <div class="grid two">
          <div class="field"><label for="nt">Title</label><input id="nt" class="input" [(ngModel)]="f.title" /></div>
          <div class="field"><label for="nr">About</label><select id="nr" class="input" [(ngModel)]="f.refType" (ngModelChange)="f.refId = ''">@for (r of refs; track r) { <option [value]="r">{{ r }}</option> }</select></div>
        </div>
        @if (options(f.refType).length) {
          <div class="field"><label for="ni">Linked {{ f.refType }}</label><select id="ni" class="input" [(ngModel)]="f.refId"><option value="">—</option>@for (o of options(f.refType); track o.id) { <option [value]="o.id">{{ o.label }}</option> }</select></div>
        }
        <div class="field"><label for="nb">Note *</label><textarea id="nb" class="input" rows="6" [(ngModel)]="f.body"></textarea></div>
        <div class="row between">
          @if (f.id) { <button class="btn danger sm" (click)="remove(f.id)">Delete</button> } @else { <span></span> }
          <span class="row"><button class="btn" (click)="form.set(null)">Cancel</button><button class="btn primary" (click)="save(f)" [disabled]="!f.body.trim()">Save</button></span>
        </div>
      </app-modal>
    }
  </div>`,
})
export class NotesComponent implements OnInit {
  svc = inject(NoteService);
  private md = inject(MasterDataStore);
  private topics = inject(TopicService);
  private projects = inject(ProjectService);
  private jobs = inject(JobService);
  private interviews = inject(InterviewService);
  private toast = inject(ToastService);
  refs: NoteRef[] = ['general', 'question', 'topic', 'project', 'interview', 'job'];
  q = signal('');
  ref = signal<NoteRef | ''>('');
  form = signal<(Note & { id?: string }) | null>(null);
  list = computed(() => {
    const q = this.q().toLowerCase();
    return this.svc.items().filter(n => (!this.ref() || (n.refType || 'question') === this.ref()) && (!q || n.body.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q)));
  });
  ngOnInit() {
    Promise.all([this.svc.ensureLoaded(), this.md.ensureLoaded(), this.projects.ensureLoaded(), this.jobs.ensureLoaded(), this.interviews.ensureLoaded()]).catch(e => this.toast.bad(errorMessage(e)));
  }
  options(r: NoteRef): { id: string; label: string }[] {
    switch (r) {
      case 'topic': return this.topics.list().map(t => ({ id: t.id, label: t.name }));
      case 'project': return this.projects.items().map(p => ({ id: p.id, label: p.name }));
      case 'job': return this.jobs.items().map(j => ({ id: j.id, label: `${j.company} — ${j.title}` }));
      case 'interview': return this.interviews.items().map(i => ({ id: i.id, label: `${i.company} · ${i.round} · ${i.date}` }));
      default: return [];
    }
  }
  link(n: Note): unknown[] | null {
    if (n.questionId || n.refType === 'question') return ['/app/questions', n.questionId || n.refId];
    if (n.refType === 'job' && n.refId) return ['/app/jobs', n.refId];
    if (n.refType === 'project') return ['/app/projects'];
    return null;
  }
  open(n: (Note & { id?: string }) | null) {
    this.form.set(n ? { ...n, refType: n.refType || 'question' } : { refType: 'general', refId: '', title: '', body: '', tags: [] });
  }
  async save(f: Note & { id?: string }) {
    try { await this.svc.save({ ...f, refId: f.refId || undefined }, f.id); this.form.set(null); } catch (e) { this.toast.bad(errorMessage(e)); }
  }
  async remove(id: string) {
    if (!confirm('Delete this note?')) return;
    try { await this.svc.remove(id); this.form.set(null); } catch (e) { this.toast.bad(errorMessage(e)); }
  }
}
