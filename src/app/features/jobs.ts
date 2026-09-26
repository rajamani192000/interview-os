import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SkillCoverage } from '../core/logic/jd';
import { InterviewRound, Job, JOB_STATUSES, JobStatus } from '../core/models';
import { InterviewService, JobService } from '../core/services/career.service';
import { MasterDataStore } from '../core/services/master-data.service';
import { DailyPlanService } from '../core/services/plan.service';
import { ClockService, ToastService } from '../core/services/platform.service';
import { AttemptService, NoteService, RevisionService } from '../core/services/practice.service';
import { daysBetween, errorMessage } from '../core/util';
import { UI } from '../shared/ui';

const emptyJob = (today: string): Job => ({ company: '', title: '', location: '', url: '', source: '', status: 'Saved', salaryNote: '', jd: '', skills: [], appliedOn: '', interviewDate: '', round: '', result: '', notes: '', archived: false, nextAction: '', nextActionDate: today });

@Component({
  selector: 'app-jobs',
  imports: [FormsModule, RouterLink, forwardRef(() => JobFormComponent), ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    <app-page-header title="Jobs" subtitle="Applications, interview rounds and job-specific preparation"><button class="btn primary" (click)="openNew()">+ Add job</button></app-page-header>
    @if (jobs.state() === 'loading' && !jobs.items().length) { <app-loading /> }
    @else if (jobs.state() === 'error') { <app-error [message]="jobs.error()" (retry)="load()" /> }
    @else {
      @if (interviews.upcoming().length) {
        <section class="card stack"><h3>Upcoming interviews</h3>
          @for (i of interviews.upcoming(); track i.id) {
            <a class="row between small" [routerLink]="i.jobId ? ['/app/jobs', i.jobId] : null" style="color:var(--text)"><span>{{ i.company }} · {{ i.round }} · {{ i.date }} {{ i.time || '' }} ({{ i.mode }})</span><span class="badge {{ interviews.daysTo(i) <= 2 ? 'warn' : '' }}">{{ countdown(i.date) }}</span></a>
          }
        </section>
      }
      <div class="tabs">
        <button class="chip" [class.on]="!status()" (click)="status.set('')">All ({{ visible().length }})</button>
        @for (s of statuses; track s) { @if (jobs.byStatus()[s]) { <button class="chip" [class.on]="status() === s" (click)="status.set(s)">{{ s }} ({{ jobs.byStatus()[s] }})</button> } }
        <button class="chip" [class.on]="showArchived()" (click)="showArchived.set(!showArchived())">Archived</button>
      </div>
      @if (!list().length) {
        <app-empty title="No jobs tracked" text="Add a job with its description to see which skills you have covered and to track your interview rounds."><button class="btn primary" (click)="openNew()">Add your first job</button></app-empty>
      }
      <div class="grid two">
        @for (j of list(); track j.id) {
          <a class="card stack" [routerLink]="['/app/jobs', j.id]" style="color:var(--text);text-decoration:none;gap:6px">
            <div class="row between"><b>{{ j.company }}</b><span class="badge {{ j.status === 'Offer' ? 'good' : j.status === 'Rejected' ? 'bad' : '' }}">{{ j.status }}</span></div>
            <span class="small">{{ j.title }}</span>
            <span class="xs muted">{{ j.location || '—' }}{{ j.appliedOn ? ' · applied ' + j.appliedOn : '' }}{{ j.interviewDate ? ' · interview ' + j.interviewDate : '' }}</span>
          </a>
        }
      </div>
    }
    @if (editing(); as e) { <app-job-form [job]="e" (closed)="editing.set(null)" /> }
  </div>`,
})
export class JobsComponent implements OnInit {
  jobs = inject(JobService);
  interviews = inject(InterviewService);
  private clock = inject(ClockService);
  private route = inject(ActivatedRoute);
  statuses = JOB_STATUSES;
  status = signal<JobStatus | ''>('');
  showArchived = signal(false);
  editing = signal<Job | null>(null);
  visible = computed(() => this.jobs.items().filter(j => j.archived === this.showArchived()));
  list = computed(() => this.visible().filter(j => !this.status() || j.status === this.status()));
  ngOnInit() {
    this.load();
    if (this.route.snapshot.queryParamMap.get('new')) this.openNew();
  }
  load() { Promise.all([this.jobs.ensureLoaded(), this.interviews.ensureLoaded()]).catch(() => undefined); }
  openNew() { this.editing.set(emptyJob(this.clock.today())); }
  countdown(d: string) { const n = daysBetween(this.clock.today(), d); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`; }
}

@Component({
  selector: 'app-job-form',
  imports: [FormsModule, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-modal [title]="f.id ? 'Edit job' : 'Add job'" (closed)="closed.emit()">
    <div class="grid two">
      <div class="field"><label for="jc">Company *</label><input id="jc" class="input" [(ngModel)]="f.company" /></div>
      <div class="field"><label for="jt">Role *</label><input id="jt" class="input" [(ngModel)]="f.title" /></div>
      <div class="field"><label for="jl">Location</label><input id="jl" class="input" [(ngModel)]="f.location" /></div>
      <div class="field"><label for="js">Salary (as advertised / discussed)</label><input id="js" class="input" [(ngModel)]="f.salaryNote" /></div>
      <div class="field"><label for="jst">Status</label><select id="jst" class="input" [(ngModel)]="f.status">@for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select></div>
      <div class="field"><label for="ja">Application date</label><input id="ja" class="input" type="date" [(ngModel)]="f.appliedOn" /></div>
      <div class="field"><label for="ji">Interview date</label><input id="ji" class="input" type="date" [(ngModel)]="f.interviewDate" /></div>
      <div class="field"><label for="jr">Round</label><input id="jr" class="input" [(ngModel)]="f.round" placeholder="Technical 1" /></div>
      <div class="field"><label for="ju">Job link</label><input id="ju" class="input" type="url" [(ngModel)]="f.url" /></div>
      <div class="field"><label for="jres">Result</label><input id="jres" class="input" [(ngModel)]="f.result" placeholder="e.g. Waiting, Selected, Not selected" /></div>
    </div>
    <div class="field"><label for="jd">Job description</label><textarea id="jd" class="input" rows="6" [(ngModel)]="f.jd" placeholder="Paste the full JD to map it against your questions"></textarea></div>
    <div class="field"><label for="jn">Notes</label><textarea id="jn" class="input" rows="3" [(ngModel)]="f.notes"></textarea></div>
    @if (dup()) { <div class="banner warn small">You already track {{ dup()!.company }} — {{ dup()!.title }}. Saving creates a second entry.</div> }
    @if (error()) { <div class="banner bad small">{{ error() }}</div> }
    <div class="row between">
      @if (f.id) { <button class="btn danger sm" (click)="archive()">{{ f.archived ? 'Unarchive' : 'Archive' }}</button> } @else { <span></span> }
      <span class="row"><button class="btn" (click)="closed.emit()">Cancel</button><button class="btn primary" (click)="save()" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button></span>
    </div>
  </app-modal>`,
})
export class JobFormComponent implements OnInit {
  private jobs = inject(JobService);
  private interviews = inject(InterviewService);
  private toast = inject(ToastService);
  private router = inject(Router);
  job = input.required<Job & { id?: string }>();
  closed = output();
  statuses = JOB_STATUSES;
  busy = signal(false);
  error = signal('');
  f!: Job & { id?: string };
  dup = signal<Job | null>(null);
  ngOnInit() { this.f = { ...this.job() }; }

  async save() {
    const f = this.f;
    this.error.set('');
    if (!f.company.trim() || !f.title.trim()) return this.error.set('Company and role are required.');
    if (!f.id && !this.dup()) { const d = this.jobs.duplicateOf(f); if (d) { this.dup.set(d); return; } }
    if (f.url && !/^https?:\/\//i.test(f.url)) return this.error.set('The job link must start with http:// or https://');
    this.busy.set(true);
    try {
      const job: Job = { ...f, company: f.company.trim(), title: f.title.trim(), skills: this.jobs.skillsFromJd(f.jd), appliedOn: f.appliedOn || (f.status !== 'Saved' ? f.appliedOn : '') };
      const saved = await this.jobs.save(job, f.id);
      if (f.interviewDate) {
        const existing = this.interviews.forJob(saved.id).find(i => i.status === 'Scheduled' && (i.round === (f.round || 'Interview') || i.date === f.interviewDate));
        const round: InterviewRound = { ...(existing || {}), jobId: saved.id, company: saved.company, round: f.round || 'Interview', date: f.interviewDate, mode: existing?.mode || 'Online', status: 'Scheduled', prepQuestionIds: existing?.prepQuestionIds || [] };
        await this.interviews.save(round, existing?.id);
      }
      this.toast.good('Job saved');
      this.closed.emit();
      if (!f.id) this.router.navigate(['/app/jobs', saved.id]);
    } catch (e) { this.error.set(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async archive() {
    try { await this.jobs.patch(this.f.id!, { archived: !this.f.archived }); this.closed.emit(); } catch (e) { this.error.set(errorMessage(e)); }
  }
}

@Component({
  selector: 'app-job-detail',
  imports: [FormsModule, RouterLink, JobFormComponent, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page stack">
    @if (loading()) { <app-loading /> }
    @else if (!job()) { <app-empty title="Job not found"><a class="btn" routerLink="/app/jobs">All jobs</a></app-empty> }
    @else if (job(); as j) {
      <app-page-header [title]="j.company" [subtitle]="j.title + (j.location ? ' · ' + j.location : '')" back="/app/jobs"><button class="btn" (click)="edit.set(true)">Edit</button></app-page-header>
      <section class="card stack">
        <div class="row"><span class="label">Status</span>
          <select class="input" style="width:auto" [ngModel]="j.status" (ngModelChange)="setStatus($event)">@for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select>
          @if (j.salaryNote) { <span class="badge">{{ j.salaryNote }}</span> } @if (j.url) { <a class="small" [href]="j.url" target="_blank" rel="noopener">Open posting ↗</a> }</div>
        <div class="small muted">Applied {{ j.appliedOn || '—' }} · Round {{ j.round || '—' }} · Result {{ j.result || '—' }}</div>
        @if (j.notes) { <div class="small pre">{{ j.notes }}</div> }
      </section>

      <section class="card stack">
        <div class="row between"><h3 style="margin:0">Job description mapping</h3>
          <span class="row small"><span class="badge good">{{ counts().covered }} covered</span><span class="badge warn">{{ counts().partial }} partial</span><span class="badge bad">{{ counts().needs }} need prep</span></span></div>
        @if (!j.jd.trim()) { <p class="small muted" style="margin:0">Paste the job description (Edit) to map it against your questions.</p> }
        @else if (!coverage().length) { <p class="small muted" style="margin:0">No known skills were detected in this description.</p> }
        @for (c of coverage(); track c.skill) {
          <div class="list-item"><div class="grow stack" style="gap:2px"><b class="small">{{ c.skill }}</b><span class="xs muted">{{ c.note }}</span></div>
            <span class="badge {{ c.coverage === 'Covered' ? 'good' : c.coverage === 'Partially covered' ? 'warn' : 'bad' }}">{{ c.coverage }}</span>
            @if (c.questionIds.length && c.coverage !== 'Covered') { <a class="btn sm" routerLink="/app/practice" [queryParams]="{ ids: c.questionIds.join(',') }">Practise</a> }</div>
        }
        @if (gapIds().length) { <div class="row"><a class="btn primary" routerLink="/app/practice" [queryParams]="{ ids: gapIds().join(',') }" (click)="markPrep()">Practise all gaps ({{ gapIds().length }})</a>
          <a class="btn" routerLink="/app/mock-interview" [queryParams]="{ job: j.id }">Mock for this job</a></div> }
      </section>

      <section class="card stack">
        <div class="row between"><h3 style="margin:0">Interview rounds</h3><button class="btn sm" (click)="newRound()">+ Add round</button></div>
        @for (i of rounds(); track i.id) {
          <div class="list-item"><div class="grow stack" style="gap:2px"><b class="small">{{ i.round }} · {{ i.date }} {{ i.time || '' }}</b><span class="xs muted">{{ i.mode }} · {{ i.status }}{{ i.outcome ? ' · ' + i.outcome : '' }}{{ i.notes ? ' · ' + i.notes : '' }}</span></div>
            <button class="btn sm ghost" (click)="round.set(i)">Edit</button></div>
        } @empty { <p class="small muted" style="margin:0">No rounds yet. Adding a date turns on the countdown and adjusts your daily plan.</p> }
      </section>

      <section class="card stack">
        <h3>Notes</h3>
        @for (n of notes(); track n.id) { <div class="small pre" style="border-bottom:1px solid var(--border);padding-bottom:6px">{{ n.body }}</div> }
        <textarea class="input" rows="3" [(ngModel)]="noteText" placeholder="Recruiter call notes, questions asked, follow-ups"></textarea>
        <div><button class="btn sm primary" (click)="addNote(j)" [disabled]="!noteText.trim()">Save note</button></div>
      </section>

      @if (edit()) { <app-job-form [job]="j" (closed)="edit.set(false)" /> }
      @if (round(); as r) {
        <app-modal [title]="r.id ? 'Edit round' : 'Add round'" (closed)="round.set(null)">
          <div class="grid two">
            <div class="field"><label for="rr">Round</label><input id="rr" class="input" [(ngModel)]="r.round" /></div>
            <div class="field"><label for="rm">Mode</label><select id="rm" class="input" [(ngModel)]="r.mode"><option>Online</option><option>Onsite</option><option>Phone</option></select></div>
            <div class="field"><label for="rd">Date</label><input id="rd" class="input" type="date" [(ngModel)]="r.date" /></div>
            <div class="field"><label for="rt">Time</label><input id="rt" class="input" type="time" [(ngModel)]="r.time" /></div>
            <div class="field"><label for="rs">Status</label><select id="rs" class="input" [(ngModel)]="r.status"><option>Scheduled</option><option>Completed</option><option>Cancelled</option></select></div>
            <div class="field"><label for="ro">Outcome</label><select id="ro" class="input" [(ngModel)]="r.outcome"><option [ngValue]="undefined">—</option><option>Waiting</option><option>Passed</option><option>Rejected</option></select></div>
          </div>
          <div class="field"><label for="rn">Notes / questions asked</label><textarea id="rn" class="input" rows="3" [(ngModel)]="r.notes"></textarea></div>
          <div class="row" style="justify-content:flex-end"><button class="btn" (click)="round.set(null)">Cancel</button><button class="btn primary" (click)="saveRound(r)">Save</button></div>
        </app-modal>
      }
    }
  </div>`,
})
export class JobDetailComponent implements OnInit {
  id = input.required<string>();
  private jobs = inject(JobService);
  private interviews = inject(InterviewService);
  private md = inject(MasterDataStore);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  private notesSvc = inject(NoteService);
  private plan = inject(DailyPlanService);
  private clock = inject(ClockService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  statuses = JOB_STATUSES;
  loading = signal(true);
  edit = signal(false);
  round = signal<(InterviewRound & { id?: string }) | null>(null);
  noteText = '';
  job = computed(() => this.jobs.byId(this.id()));
  coverage = computed<SkillCoverage[]>(() => { const j = this.job(); this.revision.items(); this.attempts.items(); return j && this.md.state() === 'ready' ? this.jobs.coverage(j) : []; });
  counts = computed(() => ({ covered: this.coverage().filter(c => c.coverage === 'Covered').length, partial: this.coverage().filter(c => c.coverage === 'Partially covered').length, needs: this.coverage().filter(c => c.coverage === 'Needs preparation').length }));
  gapIds = computed(() => [...new Set(this.coverage().filter(c => c.coverage !== 'Covered').flatMap(c => c.questionIds.slice(0, 4)))].slice(0, 20));
  rounds = computed(() => this.interviews.forJob(this.id()).sort((a, b) => a.date.localeCompare(b.date)));
  notes = computed(() => this.notesSvc.items().filter(n => n.refType === 'job' && n.refId === this.id()));

  async ngOnInit() {
    try { await Promise.all([this.jobs.ensureLoaded(), this.interviews.ensureLoaded(), this.md.ensureLoaded(), this.revision.ensureLoaded(), this.attempts.ensureLoaded(), this.notesSvc.ensureLoaded()]); }
    catch (e) { this.toast.bad(errorMessage(e)); }
    finally { this.loading.set(false); }
  }
  async setStatus(s: JobStatus) {
    try { await this.jobs.setStatus(this.id(), s, this.clock.today()); this.toast.good('Status updated'); } catch (e) { this.toast.bad(errorMessage(e)); }
  }
  newRound() {
    const j = this.job()!;
    this.round.set({ jobId: j.id, company: j.company, round: 'Technical', date: this.clock.today(), mode: 'Online', status: 'Scheduled', prepQuestionIds: [] });
  }
  async saveRound(r: InterviewRound & { id?: string }) {
    if (!r.round.trim() || !r.date) { this.toast.bad('Round name and date are required.'); return; }
    try {
      await this.interviews.save(r, r.id);
      const j = this.job()!;
      if (r.status === 'Scheduled' && r.date >= this.clock.today()) await this.jobs.patch(j.id, { interviewDate: r.date, round: r.round, status: j.status === 'Saved' || j.status === 'Applied' || j.status === 'Recruiter Contacted' ? 'Interview Scheduled' : j.status });
      if (r.outcome) await this.jobs.patch(j.id, { result: `${r.round}: ${r.outcome}` });
      this.round.set(null);
      this.plan.regenerate().catch(() => undefined);
    } catch (e) { this.toast.bad(errorMessage(e)); }
  }
  async addNote(j: Job & { id: string }) {
    try { await this.notesSvc.save({ refType: 'job', refId: j.id, title: `${j.company} — ${j.title}`, body: this.noteText.trim(), tags: [] }); this.noteText = ''; }
    catch (e) { this.toast.bad(errorMessage(e)); }
  }
  markPrep() {
    if (this.route.snapshot.queryParamMap.get('plan')) this.plan.completeMatching('job-prep', this.id()).catch(() => undefined);
  }
}
