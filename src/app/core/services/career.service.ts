import { computed, inject, Injectable } from '@angular/core';
import { extractSkills, mapJd } from '../logic/jd';
import { InterviewRound, Job, JobStatus, Project } from '../models';
import { daysBetween } from '../util';
import { UserCollection } from './collection';
import { CategoryService, MasterDataStore, TopicService } from './master-data.service';
import { ClockService } from './platform.service';
import { AttemptService, RevisionService } from './practice.service';

const ACTIVE: JobStatus[] = ['Saved', 'Applied', 'Recruiter Contacted', 'Interview Scheduled', 'Technical', 'Managerial', 'HR'];

@Injectable({ providedIn: 'root' })
export class JobService extends UserCollection<Job> {
  private md = inject(MasterDataStore);
  private topics = inject(TopicService);
  private cats = inject(CategoryService);
  private revision = inject(RevisionService);
  private attempts = inject(AttemptService);
  constructor() { super('jobs', { orderBy: [['updatedAt', 'desc']], limit: 500 }); }

  readonly active = computed(() => this.items().filter(j => !j.archived && ACTIVE.includes(j.status)));
  readonly byStatus = computed(() => {
    const m: Record<string, number> = {};
    for (const j of this.items().filter(x => !x.archived)) m[j.status] = (m[j.status] || 0) + 1;
    return m;
  });

  /** Finds an existing job with the same company + title (case/space-insensitive) or same URL. */
  duplicateOf(j: Pick<Job, 'company' | 'title' | 'url'>, exceptId?: string) {
    const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return this.items().find(x => x.id !== exceptId && ((j.url && norm(x.url) === norm(j.url)) || (norm(x.company) === norm(j.company) && norm(x.title) === norm(j.title))));
  }

  skillsFromJd(jd: string) {
    return extractSkills(jd);
  }

  coverage(job: Job) {
    return mapJd(job.jd, this.md.questions(), this.topics.list(), this.cats.list(), this.revision.items(), this.attempts.items(), job.skills);
  }

  async setStatus(id: string, status: JobStatus, today: string) {
    const j = this.byId(id);
    await this.patch(id, { status, appliedOn: status === 'Applied' && !j?.appliedOn ? today : j?.appliedOn });
  }
}

@Injectable({ providedIn: 'root' })
export class InterviewService extends UserCollection<InterviewRound> {
  private clock = inject(ClockService);
  constructor() { super('interviews', { orderBy: [['date', 'asc']], limit: 500 }); }
  readonly upcoming = computed(() => {
    const t = this.clock.today();
    return this.items().filter(i => i.status === 'Scheduled' && i.date >= t).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  });
  readonly next = computed<(InterviewRound & { id: string }) | null>(() => this.upcoming()[0] ?? null);
  daysTo(i: InterviewRound) {
    return daysBetween(this.clock.today(), i.date);
  }
  forJob(jobId: string) {
    return this.items().filter(i => i.jobId === jobId);
  }
}

@Injectable({ providedIn: 'root' })
export class ProjectService extends UserCollection<Project> {
  constructor() { super('projects', { orderBy: [['updatedAt', 'desc']], limit: 100 }); }
}
