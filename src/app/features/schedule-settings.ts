import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { fmtDuration, validateWeekly, WeeklySchedule } from '../core/logic/schedule';
import { DailyPlanService } from '../core/services/plan.service';
import { ToastService } from '../core/services/platform.service';
import { deviceTimeZone, ScheduleService } from '../core/services/schedule.service';
import { errorMessage } from '../core/util';
import { AllowanceComponent, ScheduleCalendarComponent, WeeklyEditorComponent } from '../shared/schedule-ui';
import { UI } from '../shared/ui';

/** Settings → Practice / Spending Time: weekly schedule, calendar overrides, enforcement, history. */
@Component({
  selector: 'app-schedule-settings',
  imports: [FormsModule, DatePipe, WeeklyEditorComponent, ScheduleCalendarComponent, AllowanceComponent, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (s.state() === 'loading' && !draft()) { <app-loading text="Loading your schedule…" /> }
  @else if (s.state() === 'error') { <app-error title="Couldn't load your schedule" [message]="s.error()" (retry)="load()" /> }
  @else if (draft(); as d) {
    <div class="stack">
      <app-allowance [showLink]="false" />
      <section class="card stack">
        <h3 style="margin:0">Weekly Schedule</h3>
        <label class="check small"><input type="checkbox" [ngModel]="d.enforce" (ngModelChange)="patch({ enforce: $event })" /> Enforce: lock practice screens outside the allowed time and after the daily limit</label>
        @if (s.tzMismatch()) {
          <div class="banner warn small">This schedule uses {{ d.timezone }} time, but this device is on {{ deviceTz }}. Times are applied in {{ d.timezone }}.
            <button class="btn sm" (click)="patch({ timezone: deviceTz })">Use {{ deviceTz }}</button></div>
        } @else { <span class="xs muted">Time zone: {{ d.timezone }}</span> }
        <app-weekly-editor [value]="d" (valueChange)="draft.set($event)" />
        @for (e of check().errors; track e) { <div class="error-text" role="alert">{{ e }}</div> }
        @for (w of check().warnings; track w) { <div class="hint">{{ w }}</div> }
        <div class="row"><button class="btn primary" (click)="save()" [disabled]="busy() || !dirty() || check().errors.length > 0">{{ busy() ? 'Saving…' : 'Save weekly schedule' }}</button>
          @if (dirty()) { <button class="btn ghost" (click)="reset()">Discard changes</button> }</div>
      </section>
      <section class="card stack">
        <h3 style="margin:0">Calendar Schedule</h3>
        <p class="small muted" style="margin:0">A date override replaces the weekly schedule for that date only. Priority: date override → day schedule → default daily schedule.</p>
        <app-schedule-calendar (changed)="afterChange()" />
      </section>
      <section class="card stack">
        <h3 style="margin:0">Schedule history</h3>
        @for (h of s.history().slice(0, 10); track h.id) { <div class="row between small"><span class="grow">{{ h.summary }}</span><span class="xs muted nowrap">{{ h.createdAt | date: 'd MMM, HH:mm' }}</span></div> }
        @empty { <p class="small muted" style="margin:0">No changes yet.</p> }
      </section>
    </div>
  }`,
})
export class ScheduleSettingsComponent implements OnInit {
  s = inject(ScheduleService);
  private plan = inject(DailyPlanService);
  private toast = inject(ToastService);
  deviceTz = deviceTimeZone();
  draft = signal<WeeklySchedule | null>(null);
  busy = signal(false);
  check = computed(() => (this.draft() ? validateWeekly(this.draft()!) : { errors: [], warnings: [] }));
  dirty = computed(() => JSON.stringify(strip(this.draft())) !== JSON.stringify(strip(this.s.weekly())));

  ngOnInit() { this.load(); }
  async load() {
    try {
      await this.s.ensureLoaded();
      this.reset();
      this.s.loadHistory().catch(() => undefined);
    } catch { /* error state shown */ }
  }
  reset() { this.draft.set(structuredClone(this.s.weekly())); }
  patch(p: Partial<WeeklySchedule>) { this.draft.set({ ...this.draft()!, ...p }); }
  async save() {
    this.busy.set(true);
    try {
      const warnings = await this.s.saveWeekly(this.draft()!);
      this.reset();
      const a = this.s.access();
      // editing today's schedule while practising: the new limits apply immediately
      this.toast.good(a ? `Saved. Today: ${a.remainingSeconds === null ? 'unlimited' : fmtDuration(a.remainingSeconds) + ' left'}${a.allowed ? '' : ' — ' + a.message}` : 'Saved');
      warnings.forEach(w => this.toast.show(w));
      this.plan.regenerate().catch(() => undefined);
    } catch (e) { this.toast.bad(errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  afterChange() {
    this.toast.good('Calendar updated');
    this.plan.regenerate().catch(() => undefined);
  }
}

function strip(w: WeeklySchedule | null) {
  if (!w) return null;
  const { updatedAt: _u, migratedFrom: _m, ...rest } = w;
  return rest;
}
