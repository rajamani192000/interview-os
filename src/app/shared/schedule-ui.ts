import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ALL_DAY, DateOverride, DaySchedule, DAY_NAME, dayConfig, DurationUnit, effectiveFor, fmtDuration, fmtLimit, fromMinutes, toMinutes, validateDay,
  validateOverride, validateWeekly, WEEK, WeeklySchedule, windowLabel,
} from '../core/logic/schedule';
import { ScheduleService } from '../core/services/schedule.service';
import { ModalComponent } from './ui';

/** Editor for one day (or the "every day" default). */
@Component({
  selector: 'app-day-editor',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="stack" style="gap:10px">
    <label class="check"><input type="checkbox" [ngModel]="day().enabled" (ngModelChange)="patch({ enabled: $event })" [attr.aria-label]="label() + ' enabled'" /> <b>{{ label() }}</b>: practice {{ day().enabled ? 'enabled' : 'disabled' }}</label>
    @if (day().enabled) {
      <div class="grid two">
        <div class="field"><label [for]="id + 's'">Start time</label><input [id]="id + 's'" class="input" type="time" [ngModel]="day().start" (ngModelChange)="patch({ start: $event })" /></div>
        <div class="field"><label [for]="id + 'e'">End time</label><input [id]="id + 'e'" class="input" type="time" [ngModel]="day().end" (ngModelChange)="patch({ end: $event })" /></div>
      </div>
      <div class="row"><button type="button" class="btn sm ghost" (click)="patch({ start: all.start, end: all.end })">Whole day</button><span class="xs muted">Window: {{ window() }}</span></div>
      <label class="check small"><input type="checkbox" [ngModel]="day().limitMinutes === null" (ngModelChange)="setUnlimited($event)" /> Unlimited time in this window</label>
      @if (day().limitMinutes !== null) {
        <div class="row">
          <div class="field grow"><label [for]="id + 'l'">Maximum practice time</label><input [id]="id + 'l'" class="input" type="number" min="0" [step]="day().unit === 'hours' ? 0.25 : 5" [ngModel]="value()" (ngModelChange)="setValue($event)" /></div>
          <div class="field"><label [for]="id + 'u'">Unit</label><select [id]="id + 'u'" class="input" [ngModel]="day().unit" (ngModelChange)="setUnit($event)"><option value="minutes">minutes</option><option value="hours">hours</option></select></div>
        </div>
      }
    }
    @for (e of check().errors; track e) { <div class="error-text" role="alert">{{ e }}</div> }
    @for (w of check().warnings; track w) { <div class="hint">{{ w }}</div> }
  </div>`,
})
export class DayEditorComponent {
  day = model.required<DaySchedule>();
  label = input('This day');
  all = ALL_DAY;
  id = 'd' + Math.random().toString(36).slice(2, 8);
  value = computed(() => fromMinutes(this.day().limitMinutes, this.day().unit));
  window = computed(() => windowLabel(this.day()));
  check = computed(() => validateDay(this.day(), this.label()));
  patch(p: Partial<DaySchedule>) { this.day.set({ ...this.day(), ...p }); }
  setUnlimited(on: boolean) { this.patch({ limitMinutes: on ? null : this.day().unit === 'hours' ? 60 : 60 }); }
  setValue(v: number | string) { const n = Number(v); this.patch({ limitMinutes: isFinite(n) ? toMinutes(n, this.day().unit) : 0 }); }
  setUnit(u: DurationUnit) { this.patch({ unit: u }); }
}

/** Weekly schedule editor: "same every day" or Monday → Sunday, with per-day edit and copy. */
@Component({
  selector: 'app-weekly-editor',
  imports: [FormsModule, DayEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="stack">
    <div class="row" role="radiogroup" aria-label="Schedule type">
      <button type="button" class="chip" role="radio" [attr.aria-checked]="value().mode === 'same'" [class.on]="value().mode === 'same'" (click)="setMode('same')">Same schedule every day</button>
      <button type="button" class="chip" role="radio" [attr.aria-checked]="value().mode === 'custom'" [class.on]="value().mode === 'custom'" (click)="setMode('custom')">Custom schedule for each day</button>
    </div>
    @if (value().mode === 'same') {
      <div class="card slim"><app-day-editor label="Every day" [day]="value().default" (dayChange)="setDefault($event)" /></div>
    } @else {
      <div class="list card slim" style="padding:2px 12px">
        @for (d of week; track d.key) {
          <div class="list-item" style="flex-wrap:wrap">
            <div class="grow stack" style="gap:0;min-width:160px">
              <b class="small">{{ d.name }}</b>
              <span class="xs muted">{{ summary(d.key) }}</span>
            </div>
            <button type="button" class="btn sm" (click)="open.set(open() === d.key ? null : d.key)" [attr.aria-expanded]="open() === d.key" [attr.aria-label]="(open() === d.key ? 'Close ' : 'Edit ') + d.name">{{ open() === d.key ? 'Close' : 'Edit' }}</button>
            @if (open() === d.key) {
              <div class="stack" style="width:100%;padding:8px 0">
                <app-day-editor [label]="d.name" [day]="dayOf(d.key)" (dayChange)="setDay(d.key, $event)" />
                <div class="card slim stack" style="background:var(--surface-2);gap:6px">
                  <span class="small"><b>Copy {{ d.name }}</b> to:</span>
                  <div class="row">
                    @for (t of week; track t.key) { @if (t.key !== d.key) { <label class="check small"><input type="checkbox" [checked]="copyTo().includes(t.key)" (change)="toggleCopy(t.key)" />{{ t.short }}</label> } }
                  </div>
                  <div class="row"><button type="button" class="btn sm ghost" (click)="copyTo.set(weekdaysExcept(d.key))">Weekdays</button><button type="button" class="btn sm ghost" (click)="copyTo.set(allExcept(d.key))">All days</button>
                    <button type="button" class="btn sm primary" (click)="copy(d.key)" [disabled]="!copyTo().length">Copy</button></div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
    @if (copied()) { <div class="banner good small" role="status">{{ copied() }}</div> }
  </div>`,
})
export class WeeklyEditorComponent {
  value = model.required<WeeklySchedule>();
  week = WEEK;
  open = signal<string | null>(null);
  copyTo = signal<string[]>([]);
  copied = signal('');
  dayOf(k: string): DaySchedule { return this.value().days[k] || this.value().default; }
  summary(k: string) { const d = this.dayOf(k); return d.enabled ? `${windowLabel(d)} · ${fmtLimit(d)}` : 'Disabled'; }
  setMode(mode: 'same' | 'custom') {
    const v = this.value();
    // switching to custom starts every day from the current default so nothing is lost
    const days = mode === 'custom' ? Object.fromEntries(WEEK.map(d => [d.key, v.days[d.key] && v.mode === 'custom' ? v.days[d.key] : { ...v.default }])) : v.days;
    this.value.set({ ...v, mode, days });
  }
  setDefault(d: DaySchedule) { this.value.set({ ...this.value(), default: d }); }
  setDay(k: string, d: DaySchedule) { this.value.set({ ...this.value(), days: { ...this.value().days, [k]: d } }); }
  toggleCopy(k: string) { this.copyTo.update(l => (l.includes(k) ? l.filter(x => x !== k) : [...l, k])); }
  weekdaysExcept(k: string) { return ['1', '2', '3', '4', '5'].filter(x => x !== k); }
  allExcept(k: string) { return WEEK.map(w => w.key).filter(x => x !== k); }
  copy(from: string) {
    const src = this.dayOf(from);
    const days = { ...this.value().days };
    for (const k of this.copyTo()) days[k] = { ...src };
    this.value.set({ ...this.value(), days });
    this.copied.set(`Copied ${DAY_NAME(+from)} → ${this.copyTo().map(k => DAY_NAME(+k)).join(', ')}`);
    this.copyTo.set([]);
    setTimeout(() => this.copied.set(''), 4000);
  }
  errors = computed(() => validateWeekly(this.value()));
}

/** "Today – Monday: Allowed / Used / Remaining" card, driven by ScheduleService. */
@Component({
  selector: 'app-allowance',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (s.today(); as t) { @if (s.access(); as a) {
    <section class="card stack" style="gap:8px" aria-label="Today's practice time">
      <div class="row between">
        <h3 style="margin:0">Today – {{ dayName(t.dow) }}</h3>
        <span class="badge {{ a.allowed && a.reason === 'ok' ? 'good' : a.reason === 'not-enforced' ? 'warn' : 'bad' }}">{{ statusLabel(a.reason, a.allowed) }}</span>
      </div>
      <div class="grid stats">
        <div class="stat"><span class="eyebrow">Allowed</span><b>{{ t.enabled ? limit(t.limitMinutes) : '—' }}</b></div>
        <div class="stat"><span class="eyebrow">Used</span><b>{{ dur(a.usedSeconds) }}</b></div>
        <div class="stat"><span class="eyebrow">Remaining</span><b>{{ t.enabled ? dur(a.remainingSeconds) : '—' }}</b></div>
        <div class="stat"><span class="eyebrow">Schedule</span><b style="font-size:1rem">{{ a.windowLabel }}</b></div>
      </div>
      @if (t.limitMinutes) { <div class="progress" [class.good]="(a.remainingSeconds ?? 1) > 0" role="progressbar" [attr.aria-valuenow]="pct(a.usedSeconds, t.limitMinutes)"><span [style.width.%]="pct(a.usedSeconds, t.limitMinutes)"></span></div> }
      <span class="xs muted">{{ t.source === 'override' ? 'Calendar override for today' + (t.note ? ': ' + t.note : '') : t.source === 'day' ? dayName(t.dow) + ' schedule' : 'Default daily schedule' }}{{ s.weekly()?.enforce ? '' : ' · not enforced (Settings → Practice time)' }}</span>
      @if (a.message) { <div class="banner {{ a.allowed ? 'warn' : 'bad' }} small" role="status">{{ a.message }}</div> }
      @if (showLink()) { <div><a class="btn sm ghost" routerLink="/app/settings" [queryParams]="{ tab: 'time' }">Edit practice time</a></div> }
    </section>
  } }`,
})
export class AllowanceComponent {
  s = inject(ScheduleService);
  showLink = input(true);
  dayName = DAY_NAME;
  dur = fmtDuration;
  limit = (m: number | null) => (m === null ? 'Unlimited' : fmtDuration(m * 60));
  pct = (used: number, lim: number) => Math.min(100, Math.round((used / (lim * 60)) * 100));
  statusLabel(r: string, allowed: boolean) {
    return ({ ok: 'Available now', disabled: 'Not scheduled', before: 'Not yet open', after: 'Closed for today', limit: 'Limit reached', 'not-enforced': 'Outside schedule' } as Record<string, string>)[r] || (allowed ? 'Available' : 'Unavailable');
  }
}

/** Full-screen block shown on practice screens when the schedule doesn't allow access. */
@Component({
  selector: 'app-schedule-block',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="modal-backdrop" style="z-index:45"><div class="modal stack center" role="alertdialog" aria-live="assertive" aria-label="Practice unavailable">
    <h2>Practice unavailable</h2>
    <p>{{ message() }}</p>
    <a class="btn primary block" routerLink="/app/today">Go to Today</a>
    <a class="btn ghost block" routerLink="/app/settings" [queryParams]="{ tab: 'time' }">Practice time settings</a>
  </div></div>`,
})
export class ScheduleBlockComponent {
  message = input.required<string>();
}

/** Month calendar showing normal, custom, disabled and override days; click a date to override it. */
@Component({
  selector: 'app-schedule-calendar',
  imports: [FormsModule, ModalComponent, DayEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cal .h { font-size: .72rem; color: var(--muted); text-align: center; font-weight: 600; }
    .cell { min-height: 54px; border: 1px solid var(--border); border-radius: 8px; padding: 4px; font: inherit; font-size: .75rem; text-align: left; background: var(--surface); color: var(--text); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
    .cell:disabled { opacity: .45; cursor: default; }
    .cell.today { outline: 2px solid var(--primary); }
    .cell.normal { }
    .cell.custom { background: var(--primary-soft); }
    .cell.off { background: var(--surface-2); color: var(--muted); }
    .cell.override { border: 2px solid var(--warn); }
    .cell b { font-size: .85rem; }
    .legend span { display: inline-flex; align-items: center; gap: 4px; margin-right: 10px; }
    .sw { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--border); display: inline-block; }
  `,
  template: `<div class="stack">
    <div class="row between"><button type="button" class="btn sm ghost" (click)="shift(-1)" aria-label="Previous month">‹</button><b>{{ monthLabel() }}</b><button type="button" class="btn sm ghost" (click)="shift(1)" aria-label="Next month">›</button></div>
    <div class="cal" role="grid" aria-label="Schedule calendar">
      @for (h of heads; track h) { <div class="h">{{ h }}</div> }
      @for (c of cells(); track $index) {
        @if (c) {
          <button type="button" class="cell {{ c.cls }}" [class.today]="c.date === today()" [disabled]="c.date < today()" (click)="edit(c.date)" [attr.aria-label]="c.date + ': ' + c.label">
            <b>{{ c.day }}</b><span>{{ c.short }}</span>
          </button>
        } @else { <span></span> }
      }
    </div>
    <div class="legend xs muted"><span><i class="sw"></i>Normal</span><span><i class="sw" style="background:var(--primary-soft)"></i>Custom day</span><span><i class="sw" style="background:var(--surface-2)"></i>Disabled</span><span><i class="sw" style="border:2px solid var(--warn)"></i>Override</span></div>
    <div><button type="button" class="btn primary sm" (click)="edit(today())">+ Add Calendar Override</button></div>
    @if (overrideList().length) {
      <div class="list">
        @for (o of overrideList(); track o.date) {
          <div class="list-item"><div class="grow stack" style="gap:0"><b class="small">{{ o.date }} – {{ dayName(o.date) }}</b><span class="xs muted">{{ describe(o) }}{{ o.note ? ' · ' + o.note : '' }}</span></div>
            <button type="button" class="btn sm ghost" (click)="edit(o.date)">Edit</button><button type="button" class="btn sm danger" (click)="remove(o.date)">Remove</button></div>
        }
      </div>
    } @else { <p class="small muted" style="margin:0">No overrides. Use one for a holiday, a busy day or an extra-long session before an interview.</p> }

    @if (draft(); as d) {
      <app-modal [title]="(s.overrides()[d.date] ? 'Edit' : 'Add') + ' calendar override'" (closed)="draft.set(null)">
        <div class="field"><label for="od">Date</label><input id="od" class="input" type="date" [min]="today()" [ngModel]="d.date" (ngModelChange)="setDraft({ date: $event })" /></div>
        <p class="small muted" style="margin:0">Normal schedule for this day: <b>{{ normalFor(d.date) }}</b></p>
        <div class="field"><span class="label">Override</span><div class="row">
          <button type="button" class="chip" [class.on]="d.kind === 'custom'" (click)="setDraft({ kind: 'custom' })">Custom time</button>
          <button type="button" class="chip" [class.on]="d.kind === 'disabled'" (click)="setDraft({ kind: 'disabled' })">No practice</button>
          <button type="button" class="chip" [class.on]="d.kind === 'unlimited'" (click)="setDraft({ kind: 'unlimited' })">Unlimited</button></div></div>
        @if (d.kind === 'custom') { <app-day-editor label="Override" [day]="asDay(d)" (dayChange)="fromDay($event)" /> }
        <div class="field"><label for="on">Note (optional)</label><input id="on" class="input" maxlength="120" [ngModel]="d.note || ''" (ngModelChange)="setDraft({ note: $event })" placeholder="e.g. Interview prep, travel day" /></div>
        @for (e of draftCheck().errors; track e) { <div class="error-text">{{ e }}</div> }
        @for (w of draftCheck().warnings; track w) { <div class="hint">{{ w }}</div> }
        @if (err()) { <div class="banner bad small">{{ err() }}</div> }
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn" (click)="draft.set(null)">Cancel</button>
          <button type="button" class="btn primary" (click)="save()" [disabled]="busy() || draftCheck().errors.length > 0">{{ busy() ? 'Saving…' : 'Save override' }}</button></div>
      </app-modal>
    }
  </div>`,
})
export class ScheduleCalendarComponent {
  s = inject(ScheduleService);
  heads = WEEK.map(w => w.short);
  month = signal(new Date().toISOString().slice(0, 7));
  draft = signal<DateOverride | null>(null);
  busy = signal(false);
  err = signal('');
  changed = output<string>();
  today = computed(() => this.s.now().date);
  monthLabel = computed(() => { const [y, m] = this.month().split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); });
  overrideList = computed(() => Object.values(this.s.overrides()).filter(o => o.date >= this.today()).sort((a, b) => a.date.localeCompare(b.date)));
  cells = computed(() => {
    const w = this.s.weekly();
    if (!w) return [];
    const [y, m] = this.month().split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Monday-first
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const out: ({ date: string; day: number; cls: string; short: string; label: string } | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= n; d++) {
      const date = `${this.month()}-${String(d).padStart(2, '0')}`;
      const e = effectiveFor(date, w, this.s.overrides());
      const def = w.default;
      const cfg = dayConfig(w, e.dow).d;
      const isCustom = w.mode === 'custom' && (cfg.start !== def.start || cfg.end !== def.end || cfg.limitMinutes !== def.limitMinutes || cfg.enabled !== def.enabled);
      const cls = [e.source === 'override' ? 'override' : '', !e.enabled ? 'off' : isCustom ? 'custom' : 'normal'].join(' ');
      const short = !e.enabled ? 'Off' : e.limitMinutes === null ? '∞' : fmtDuration(e.limitMinutes * 60).replace(' min', 'm').replace(/ hrs?/, 'h');
      out.push({ date, day: d, cls, short, label: !e.enabled ? 'no practice' : `${windowLabel(e)}, ${e.limitMinutes === null ? 'unlimited' : fmtDuration(e.limitMinutes * 60)}${e.source === 'override' ? ' (override)' : ''}` });
    }
    return out;
  });
  draftCheck = computed(() => { const d = this.draft(); return d ? validateOverride(d, this.today(), Object.keys(this.s.overrides()).filter(k => k !== this.editingOriginal)) : { errors: [], warnings: [] }; });
  private editingOriginal = '';

  dayName(date: string) { const [y, m, d] = date.split('-').map(Number); return DAY_NAME(new Date(Date.UTC(y, m - 1, d)).getUTCDay()); }
  describe(o: DateOverride) { return o.kind === 'disabled' ? 'No practice' : o.kind === 'unlimited' ? 'Unlimited' : `${windowLabel({ start: o.start!, end: o.end! })} · ${o.limitMinutes === null ? 'Unlimited' : fmtDuration((o.limitMinutes || 0) * 60)}`; }
  normalFor(date: string) {
    const w = this.s.weekly();
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '—';
    const e = effectiveFor(date, w, {});
    return e.enabled ? `${this.dayName(date)}: ${windowLabel(e)}, ${e.limitMinutes === null ? 'unlimited' : fmtDuration(e.limitMinutes * 60)}` : `${this.dayName(date)}: no practice`;
  }
  shift(n: number) { const [y, m] = this.month().split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); this.month.set(d.toISOString().slice(0, 7)); }
  edit(date: string) {
    const existing = this.s.overrides()[date];
    this.editingOriginal = existing ? date : '';
    const w = this.s.weekly()!;
    const base = effectiveFor(date, w, {});
    this.err.set('');
    this.draft.set(existing ? { ...existing } : { date, kind: 'custom', start: base.enabled ? base.start : '09:00', end: base.enabled ? base.end : '21:00', limitMinutes: base.limitMinutes ?? 120, unit: 'hours' });
  }
  setDraft(p: Partial<DateOverride>) { this.draft.set({ ...this.draft()!, ...p }); }
  asDay(d: DateOverride): DaySchedule { return { enabled: true, start: d.start || '09:00', end: d.end || '21:00', limitMinutes: d.limitMinutes === undefined ? 120 : d.limitMinutes, unit: d.unit || 'hours' }; }
  fromDay(x: DaySchedule) { this.setDraft({ start: x.start, end: x.end, limitMinutes: x.limitMinutes, unit: x.unit }); }
  async save() {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    this.err.set('');
    try {
      const clean: DateOverride = d.kind === 'custom' ? d : { date: d.date, kind: d.kind, note: d.note };
      if (this.editingOriginal && this.editingOriginal !== d.date) await this.s.removeOverride(this.editingOriginal);
      await this.s.saveOverride(clean);
      this.draft.set(null);
      this.changed.emit(d.date);
    } catch (e) { this.err.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
  async remove(date: string) {
    try { await this.s.removeOverride(date); this.changed.emit(date); } catch (e) { this.err.set((e as Error).message); }
  }
}
