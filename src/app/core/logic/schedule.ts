/**
 * Flexible practice schedule: weekly per-day windows + limits, date overrides, and the
 * effective-schedule / access calculation. Pure functions (unit-tested).
 *
 * Firestore:
 *   users/{uid}/schedule/weekly               WeeklySchedule
 *   users/{uid}/scheduleOverrides/{yyyy-mm-dd} DateOverride   (one per date → no duplicate conflicts)
 *   users/{uid}/usage/{yyyy-mm-dd}             DailyUsage     (seconds of practice, incremented)
 *   users/{uid}/scheduleHistory/{id}           ScheduleChange (audit trail of edits)
 *
 * Priority: Date override → Day schedule (custom mode) → Default daily schedule.
 */

export type DurationUnit = 'minutes' | 'hours';

export interface DaySchedule {
  enabled: boolean;
  start: string; // HH:mm (local to the schedule time zone)
  end: string; // HH:mm, must be after start
  limitMinutes: number | null; // null = unlimited
  unit: DurationUnit; // how the user entered/sees the limit
}

export interface WeeklySchedule {
  mode: 'same' | 'custom';
  default: DaySchedule; // used for every day in 'same' mode, and as the fallback
  days: Record<string, DaySchedule>; // '0'..'6' = Sunday..Saturday (Date.getDay())
  enforce: boolean; // true: the schedule controls access to practice screens
  timezone: string; // IANA zone the times are expressed in
  migratedFrom?: 'settings' | 'onboarding' | 'default';
  updatedAt?: number;
}

export interface DateOverride {
  date: string; // yyyy-mm-dd (also the document id)
  kind: 'custom' | 'disabled' | 'unlimited';
  start?: string;
  end?: string;
  limitMinutes?: number | null;
  unit?: DurationUnit;
  note?: string;
  createdAt?: number;
}

export interface DailyUsage {
  date: string;
  seconds: number;
  updatedAt?: number;
}

export interface ScheduleChange {
  id?: string;
  kind: 'weekly' | 'override-add' | 'override-remove' | 'migration';
  summary: string;
  date?: string;
  createdAt?: number;
}

export interface Effective {
  date: string;
  dow: number;
  source: 'override' | 'day' | 'default';
  enabled: boolean;
  start: string;
  end: string;
  limitMinutes: number | null;
  note?: string;
}

export type AccessReason = 'ok' | 'disabled' | 'before' | 'after' | 'limit' | 'not-enforced';
export interface Access {
  allowed: boolean;
  reason: AccessReason;
  message: string;
  usedSeconds: number;
  remainingSeconds: number | null; // null = unlimited
  windowLabel: string;
}

/** Display order Monday → Sunday, with Date.getDay() keys. */
export const WEEK: { key: string; name: string; short: string }[] = [
  { key: '1', name: 'Monday', short: 'Mon' },
  { key: '2', name: 'Tuesday', short: 'Tue' },
  { key: '3', name: 'Wednesday', short: 'Wed' },
  { key: '4', name: 'Thursday', short: 'Thu' },
  { key: '5', name: 'Friday', short: 'Fri' },
  { key: '6', name: 'Saturday', short: 'Sat' },
  { key: '0', name: 'Sunday', short: 'Sun' },
];
export const DAY_NAME = (dow: number) => WEEK.find(w => w.key === String(dow))!.name;

export const ALL_DAY: Pick<DaySchedule, 'start' | 'end'> = { start: '00:00', end: '23:59' };

export function mins(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : NaN;
}

export function fmtTime(hhmm: string): string {
  const t = mins(hhmm);
  if (isNaN(t)) return hhmm;
  const h = Math.floor(t / 60), m = t % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDuration(seconds: number | null): string {
  if (seconds === null) return 'Unlimited';
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60), m = total % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${h} hr${h > 1 ? 's' : ''} ${m} min`;
}

export function fmtLimit(d: Pick<DaySchedule, 'limitMinutes' | 'unit'>): string {
  if (d.limitMinutes === null) return 'Unlimited';
  if (d.unit === 'hours') { const h = d.limitMinutes / 60; return `${+h.toFixed(2)} hr${h === 1 ? '' : 's'}`; }
  return `${d.limitMinutes} min`;
}

export function windowLabel(d: Pick<DaySchedule, 'start' | 'end'>): string {
  return d.start === ALL_DAY.start && d.end === ALL_DAY.end ? 'All day' : `${fmtTime(d.start)} – ${fmtTime(d.end)}`;
}

export function daySchedule(p: Partial<DaySchedule> = {}): DaySchedule {
  return { enabled: true, start: '06:00', end: '22:00', limitMinutes: 120, unit: 'hours', ...p };
}

/**
 * Builds a weekly schedule for a user who only had the old single daily setting:
 * the existing daily minutes become every day's limit, existing study days stay enabled, and the
 * window is the whole day so nothing that worked before becomes blocked.
 */
export function fromLegacy(dailyMinutes: number, studyDays: number[], timezone: string): WeeklySchedule {
  const def: DaySchedule = { enabled: true, ...ALL_DAY, limitMinutes: Math.max(15, Math.round(dailyMinutes || 45)), unit: 'minutes' };
  const days: Record<string, DaySchedule> = {};
  for (let i = 0; i < 7; i++) days[String(i)] = { ...def, enabled: studyDays.includes(i) };
  const allOn = studyDays.length === 7;
  return { mode: allOn ? 'same' : 'custom', default: def, days, enforce: false, timezone, migratedFrom: 'settings' };
}

/** Day config for a weekday, before overrides. 'same' mode uses the default for every day. */
export function dayConfig(w: WeeklySchedule, dow: number): { d: DaySchedule; source: 'day' | 'default' } {
  if (w.mode === 'custom' && w.days[String(dow)]) return { d: w.days[String(dow)], source: 'day' };
  return { d: w.default, source: 'default' };
}

export function dowOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Effective schedule for a date. Priority: override → day schedule → default. */
export function effectiveFor(date: string, w: WeeklySchedule, overrides: Record<string, DateOverride> | DateOverride[]): Effective {
  const dow = dowOf(date);
  const o = Array.isArray(overrides) ? overrides.find(x => x.date === date) : overrides[date];
  if (o) {
    if (o.kind === 'disabled') return { date, dow, source: 'override', enabled: false, start: '00:00', end: '00:00', limitMinutes: 0, note: o.note };
    if (o.kind === 'unlimited') return { date, dow, source: 'override', enabled: true, start: o.start || ALL_DAY.start, end: o.end || ALL_DAY.end, limitMinutes: null, note: o.note };
    return { date, dow, source: 'override', enabled: true, start: o.start || ALL_DAY.start, end: o.end || ALL_DAY.end, limitMinutes: o.limitMinutes ?? null, note: o.note };
  }
  const { d, source } = dayConfig(w, dow);
  return { date, dow, source, enabled: d.enabled, start: d.start, end: d.end, limitMinutes: d.limitMinutes };
}

/** Wall-clock date/minute in a time zone (so a trip abroad doesn't shift the schedule unexpectedly). */
export function zonedNow(tz: string, at: Date = new Date()): { date: string; minutes: number; dow: number } {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value]));
    const date = `${p['year']}-${p['month']}-${p['day']}`;
    return { date, minutes: +p['hour'] * 60 + +p['minute'], dow: dowOf(date) };
  } catch {
    const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    return { date, minutes: at.getHours() * 60 + at.getMinutes(), dow: at.getDay() };
  }
}

/** Finds the next date (after `from`) with practice enabled, within 60 days. */
export function nextAvailable(from: string, w: WeeklySchedule, overrides: Record<string, DateOverride>): string | null {
  const [y, m, d] = from.split('-').map(Number);
  for (let i = 1; i <= 60; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const key = dt.toISOString().slice(0, 10);
    const e = effectiveFor(key, w, overrides);
    if (e.enabled && (e.limitMinutes === null || e.limitMinutes > 0)) return key;
  }
  return null;
}

function whenLabel(from: string, next: string | null): string {
  if (!next) return 'No upcoming practice day is scheduled';
  const [y, m, d] = from.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return next === tomorrow ? 'tomorrow' : `on ${DAY_NAME(dowOf(next))}, ${next}`;
}

/** Access decision for "now" given the effective schedule and today's usage. */
export function accessNow(e: Effective, nowMinutes: number, usedSeconds: number, enforce: boolean, next: string | null): Access {
  const wl = windowLabel(e);
  const limitSec = e.limitMinutes === null ? null : e.limitMinutes * 60;
  const remaining = limitSec === null ? null : Math.max(0, limitSec - usedSeconds);
  const base = { usedSeconds, remainingSeconds: remaining, windowLabel: e.enabled ? wl : 'Not scheduled' };
  let reason: AccessReason = 'ok';
  let message = '';
  if (!e.enabled) { reason = 'disabled'; message = 'Practice is not scheduled for today.'; }
  else if (nowMinutes < mins(e.start)) { reason = 'before'; message = `Your practice time is currently unavailable. Today's available time is ${wl}.`; }
  else if (nowMinutes >= mins(e.end) && !(e.end === ALL_DAY.end)) { reason = 'after'; message = `Your practice time is currently unavailable. Today's available time is ${wl}.`; }
  else if (remaining !== null && remaining <= 0) {
    reason = 'limit';
    const w = whenLabel(e.date, next);
    message = w === 'tomorrow' ? "You have reached today's practice time limit. Your next available session is tomorrow." : `You have reached today's practice time limit. Your next available session is ${w}.`;
  }
  if (reason === 'ok') return { ...base, allowed: true, reason, message: '' };
  if (!enforce) return { ...base, allowed: true, reason: 'not-enforced', message };
  return { ...base, allowed: false, reason, message };
}

export interface ValidationResult { errors: string[]; warnings: string[]; }

/** Validates one day (or override) configuration. */
export function validateDay(d: Pick<DaySchedule, 'enabled' | 'start' | 'end' | 'limitMinutes'>, label = 'This day'): ValidationResult {
  const errors: string[] = [], warnings: string[] = [];
  const s = mins(d.start), e = mins(d.end);
  if (isNaN(s) || isNaN(e)) { errors.push(`${label}: enter a valid start and end time.`); return { errors, warnings }; }
  if (!d.enabled) {
    if (d.limitMinutes) warnings.push(`${label} is disabled; its saved limit is kept but not used.`);
    return { errors, warnings };
  }
  if (s === e) errors.push(`${label}: start and end time can't be the same.`);
  else if (e < s) errors.push(`${label}: end time must be after start time (overnight windows aren't supported — split them across two days).`);
  if (d.limitMinutes !== null) {
    if (!(d.limitMinutes > 0)) errors.push(`${label}: maximum duration must be more than 0. Disable the day instead, or choose Unlimited.`);
    else if (!isNaN(s) && e > s && d.limitMinutes > e - s + (d.end === ALL_DAY.end ? 1 : 0)) errors.push(`${label}: maximum duration (${fmtDuration(d.limitMinutes * 60)}) is longer than the available window (${fmtDuration((e - s) * 60)}).`);
    else if (d.limitMinutes > 16 * 60) warnings.push(`${label}: over 16 hours is unusually long.`);
  }
  return { errors, warnings };
}

export function validateWeekly(w: WeeklySchedule): ValidationResult {
  const out: ValidationResult = { errors: [], warnings: [] };
  const push = (r: ValidationResult) => { out.errors.push(...r.errors); out.warnings.push(...r.warnings); };
  if (w.mode === 'same') push(validateDay(w.default, 'Every day'));
  else for (const d of WEEK) push(validateDay(w.days[d.key] || w.default, d.name));
  const active = w.mode === 'same' ? (w.default.enabled ? 7 : 0) : WEEK.filter(d => (w.days[d.key] || w.default).enabled).length;
  if (!active) out.warnings.push('Every day is disabled, so practice screens stay locked until you add an override.');
  return out;
}

export function validateOverride(o: DateOverride, today: string, existing: string[]): ValidationResult {
  const r: ValidationResult = { errors: [], warnings: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) r.errors.push('Pick a date.');
  else if (o.date < today) r.errors.push("You can't add an override for a past date.");
  if (existing.includes(o.date)) r.warnings.push(`An override for ${o.date} already exists — saving replaces it.`);
  if (o.kind === 'custom') {
    const v = validateDay({ enabled: true, start: o.start || '', end: o.end || '', limitMinutes: o.limitMinutes ?? null }, 'Override');
    r.errors.push(...v.errors);
    r.warnings.push(...v.warnings);
  }
  return r;
}

/** Converts a value typed in the chosen unit to minutes. */
export function toMinutes(value: number, unit: DurationUnit): number {
  return Math.round(unit === 'hours' ? value * 60 : value);
}
export function fromMinutes(minutes: number | null, unit: DurationUnit): number | null {
  if (minutes === null) return null;
  return unit === 'hours' ? +(minutes / 60).toFixed(2) : minutes;
}

/** Human summary of a weekly schedule (for history). */
export function summarize(w: WeeklySchedule): string {
  if (w.mode === 'same') return `Every day: ${w.default.enabled ? `${windowLabel(w.default)}, ${fmtLimit(w.default)}` : 'disabled'}`;
  return WEEK.map(d => { const x = w.days[d.key] || w.default; return `${d.short} ${x.enabled ? fmtLimit(x) : 'off'}`; }).join(' · ');
}
