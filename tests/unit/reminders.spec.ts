import { describe, expect, it } from 'vitest';
import { decideReminder, inQuietHours, ReminderState } from '../../src/app/core/logic/reminders';
import { UserSettings } from '../../src/app/core/models';

const S = (mode: UserSettings['reminders']['mode'], extra: Partial<UserSettings> = {}): UserSettings => ({
  dailyMinutes: 45, minMinutes: 15, studyDays: [0, 1, 2, 3, 4, 5, 6], preferredTime: '19:00', newPerDay: 3,
  reminders: { enabled: true, mode, quietStart: '22:30', quietEnd: '07:00', maxPerDay: 4, snoozeMinutes: 15 },
  voice: { enabled: true, rate: 1, lang: 'en-IN', saveRecordings: 'none' }, ai: { provider: 'none' }, focus: { enabled: true, neutralMessages: false }, theme: 'system', ...extra,
});
const at = (h: number, m = 0) => new Date(2026, 8, 26, h, m);
const st = (o: Partial<ReminderState>): ReminderState => ({ now: at(19), today: '2026-09-26', planComplete: false, planStarted: false, minutesDone: 0, sentToday: 0, isStudyDay: true, ...o });

describe('reminders', () => {
  it('strict escalates 19:00 → 19:15 → later, and respects the gap', () => {
    const s = S('Strict');
    const a = decideReminder(s, st({}));
    expect(a.send).toBe(true);
    expect(a.body).toBe('Your interview preparation starts now.');
    expect(decideReminder(s, st({ now: at(19, 10), sentToday: 1, lastSentAt: at(19).getTime() })).send).toBe(false);
    const b = decideReminder(s, st({ now: at(19, 15), sentToday: 1, lastSentAt: at(19).getTime() }));
    expect(b.body).toBe('Today’s preparation is still pending.');
    const c = decideReminder(s, st({ now: at(19, 30), sentToday: 2, lastSentAt: at(19, 15).getTime() }));
    expect(c.body).toBe('Complete your 15-minute minimum session.');
    expect(c.urgent).toBe(true);
  });
  it('never exceeds the daily cap, never during quiet hours, never before preferred time', () => {
    const s = S('Strict');
    expect(decideReminder(s, st({ sentToday: 4 })).reason).toBe('daily cap reached');
    expect(decideReminder(s, st({ now: at(23) })).reason).toBe('quiet hours');
    expect(decideReminder(s, st({ now: at(18) })).reason).toBe('before preferred time');
    expect(inQuietHours(at(6, 30), '22:30', '07:00')).toBe(true);
    expect(inQuietHours(at(12), '22:30', '07:00')).toBe(false);
  });
  it('stops when plan complete, snoozed, disabled or rest day', () => {
    expect(decideReminder(S('Persistent'), st({ planComplete: true })).send).toBe(false);
    expect(decideReminder(S('Persistent'), st({ snoozedUntil: at(19, 20).getTime() })).reason).toBe('snoozed');
    expect(decideReminder(S('Normal', { reminders: { ...S('Normal').reminders, enabled: false } }), st({})).reason).toBe('disabled');
    expect(decideReminder(S('Normal'), st({ isStudyDay: false })).reason).toBe('rest day');
  });
  it('normal mode stops once the minimum commitment is met and caps at 2', () => {
    expect(decideReminder(S('Normal'), st({ minutesDone: 15, planStarted: true })).reason).toBe('minimum met');
    expect(decideReminder(S('Normal'), st({ sentToday: 2 })).reason).toBe('daily cap reached');
  });
  it('interview countdown wording and neutral mode', () => {
    const d = decideReminder(S('Interview Countdown'), st({ interviewDate: '2026-10-01' }));
    expect(d.title).toBe('Interview in 5 days');
    const n = decideReminder(S('Strict', { focus: { enabled: true, neutralMessages: true } }), st({}));
    expect(n.title).toBe('Daily plan');
  });
});
