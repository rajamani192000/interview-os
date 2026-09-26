import { ReminderMode, UserSettings } from '../models';
import { daysBetween, minutesOfDay } from '../util';

export interface ReminderState {
  now: Date;
  today: string;
  planComplete: boolean;
  planStarted: boolean;
  minutesDone: number;
  sentToday: number;
  lastSentAt?: number;
  snoozedUntil?: number;
  interviewDate?: string;
  isStudyDay: boolean;
}

export interface ReminderDecision {
  send: boolean;
  reason: string;
  title?: string;
  body?: string;
  urgent?: boolean;
}

/** Admin-editable notification templates. {min} = minimum minutes, {days} = days to interview. */
export interface ReminderTemplates {
  start: string;
  pending: string;
  minimum: string;
  continue: string;
  countdown: string;
  interviewDay: string;
  neutral: string;
}
export const DEFAULT_TEMPLATES: ReminderTemplates = {
  start: 'Your interview preparation starts now.',
  pending: 'Today’s preparation is still pending.',
  minimum: 'Complete your {min}-minute minimum session.',
  continue: 'Your plan is waiting where you left it.',
  countdown: 'Interview in {days} days. A short revision round keeps answers fresh.',
  interviewDay: 'Interview day. Do a 10-minute warm-up.',
  neutral: 'Your daily plan is ready.',
};

/** Minutes between reminders by mode (Strict follows the 7:00 → 7:15 → … example). */
export const GAP: Record<ReminderMode, number> = { Normal: 180, Persistent: 45, Strict: 15, 'Interview Countdown': 30 };
/** Hard ceiling regardless of settings: never spam. */
export const ABSOLUTE_MAX = 8;

export function inQuietHours(now: Date, start: string, end: string): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  const s = minutesOfDay(start), e = minutesOfDay(end);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e; // window may cross midnight
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

/** Escalating wording: 1st = start, 2nd = pending, then minimum-session. Never shaming. */
export function reminderText(mode: ReminderMode, st: Pick<ReminderState, 'planStarted' | 'interviewDate' | 'today' | 'sentToday'>, s: Pick<UserSettings, 'minMinutes' | 'focus'>, tpl: ReminderTemplates = DEFAULT_TEMPLATES): { title: string; body: string } {
  const v = { min: s.minMinutes || 15, days: st.interviewDate ? daysBetween(st.today, st.interviewDate) : '' };
  if (s.focus.neutralMessages) return { title: 'Daily plan', body: fill(tpl.neutral, v) };
  if (st.interviewDate && (mode === 'Interview Countdown' || daysBetween(st.today, st.interviewDate) <= 1)) {
    const d = daysBetween(st.today, st.interviewDate);
    if (d === 0) return { title: 'Interview today', body: fill(tpl.interviewDay, v) };
    if (d > 0 && d <= 14) return { title: `Interview in ${d} day${d > 1 ? 's' : ''}`, body: fill(tpl.countdown, v) };
  }
  if (st.planStarted) return { title: 'Continue your plan', body: fill(tpl.continue, v) };
  if (st.sentToday === 0) return { title: 'Interview preparation', body: fill(tpl.start, v) };
  if (st.sentToday === 1) return { title: 'Still pending', body: fill(tpl.pending, v) };
  return { title: 'Minimum session', body: fill(tpl.minimum, v) };
}

export function decideReminder(settings: UserSettings, st: ReminderState, tpl?: ReminderTemplates): ReminderDecision {
  const r = settings.reminders;
  if (!r.enabled) return { send: false, reason: 'disabled' };
  if (st.planComplete) return { send: false, reason: 'plan complete' };
  const interviewSoon = !!st.interviewDate && daysBetween(st.today, st.interviewDate) >= 0 && daysBetween(st.today, st.interviewDate) <= 14;
  const mode: ReminderMode = r.mode === 'Interview Countdown' && !interviewSoon ? 'Persistent' : r.mode;
  if (!st.isStudyDay && !interviewSoon) return { send: false, reason: 'rest day' };
  if (inQuietHours(st.now, r.quietStart, r.quietEnd)) return { send: false, reason: 'quiet hours' };
  if (st.snoozedUntil && st.now.getTime() < st.snoozedUntil) return { send: false, reason: 'snoozed' };
  const cap = Math.min(ABSOLUTE_MAX, mode === 'Normal' ? Math.min(r.maxPerDay, 2) : r.maxPerDay);
  if (st.sentToday >= cap) return { send: false, reason: 'daily cap reached' };
  const nowMin = st.now.getHours() * 60 + st.now.getMinutes();
  if (nowMin < minutesOfDay(settings.preferredTime)) return { send: false, reason: 'before preferred time' };
  if (st.lastSentAt && st.now.getTime() - st.lastSentAt < GAP[mode] * 60000) return { send: false, reason: 'too soon' };
  // minimum commitment already met in Normal mode → stop nudging
  if (mode === 'Normal' && st.minutesDone >= (settings.minMinutes || 15)) return { send: false, reason: 'minimum met' };
  const t = reminderText(mode, st, settings, tpl);
  return { send: true, reason: 'due', ...t, urgent: mode === 'Strict' || mode === 'Interview Countdown' };
}
