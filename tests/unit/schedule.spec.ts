import { describe, expect, it } from 'vitest';
import { accessNow, DateOverride, daySchedule, effectiveFor, fmtDuration, fromLegacy, nextAvailable, validateDay, validateOverride, validateWeekly, WeeklySchedule, zonedNow } from '../../src/app/core/logic/schedule';

// 2026-09-28 is a Monday
const W: WeeklySchedule = {
  mode: 'custom', enforce: true, timezone: 'Asia/Kolkata',
  default: daySchedule({ start: '06:00', end: '21:00', limitMinutes: 120 }),
  days: {
    '1': daySchedule({ start: '06:00', end: '20:00', limitMinutes: 120 }),
    '2': daySchedule({ start: '07:00', end: '22:00', limitMinutes: 180 }),
    '3': daySchedule({ start: '06:00', end: '18:00', limitMinutes: 90, unit: 'minutes' }),
    '4': daySchedule({ start: '07:00', end: '22:00', limitMinutes: 120 }),
    '5': daySchedule({ start: '06:00', end: '20:00', limitMinutes: 120 }),
    '6': daySchedule({ start: '08:00', end: '23:00', limitMinutes: 240 }),
    '0': daySchedule({ start: '09:00', end: '18:00', limitMinutes: null }),
  },
};
const O: Record<string, DateOverride> = {
  '2026-09-28': { date: '2026-09-28', kind: 'custom', start: '06:00', end: '22:00', limitMinutes: 240, unit: 'hours' },
  '2026-10-02': { date: '2026-10-02', kind: 'disabled' },
};

describe('effective schedule priority', () => {
  it('date override beats the day schedule', () => {
    const e = effectiveFor('2026-09-28', W, O);
    expect(e).toMatchObject({ source: 'override', limitMinutes: 240, end: '22:00' });
    expect(effectiveFor('2026-10-02', W, O)).toMatchObject({ source: 'override', enabled: false });
  });
  it('each weekday has its own window and limit', () => {
    expect(effectiveFor('2026-09-29', W, O)).toMatchObject({ source: 'day', dow: 2, start: '07:00', limitMinutes: 180 });
    expect(effectiveFor('2026-09-30', W, O)).toMatchObject({ limitMinutes: 90, end: '18:00' });
    expect(effectiveFor('2026-10-04', W, O)).toMatchObject({ dow: 0, limitMinutes: null });
  });
  it("'same' mode uses the default for every day", () => {
    const s = { ...W, mode: 'same' as const };
    expect(effectiveFor('2026-09-29', s, {})).toMatchObject({ source: 'default', limitMinutes: 120, end: '21:00' });
  });
});

describe('access control', () => {
  const tue = effectiveFor('2026-09-29', W, O); // 07:00–22:00, 3h
  const next = nextAvailable('2026-09-29', W, O);
  it('allowed inside the window with time left', () => {
    const a = accessNow(tue, 10 * 60, 45 * 60, true, next);
    expect(a).toMatchObject({ allowed: true, reason: 'ok', remainingSeconds: 135 * 60 });
  });
  it('blocked before/after the window with the exact message', () => {
    const a = accessNow(tue, 6 * 60, 0, true, next);
    expect(a.allowed).toBe(false);
    expect(a.message).toBe("Your practice time is currently unavailable. Today's available time is 7:00 AM – 10:00 PM.");
    expect(accessNow(tue, 22 * 60, 0, true, next).reason).toBe('after');
  });
  it('blocked at the limit, next session tomorrow', () => {
    const a = accessNow(tue, 12 * 60, 180 * 60, true, next);
    expect(a).toMatchObject({ allowed: false, reason: 'limit', remainingSeconds: 0 });
    expect(a.message).toBe("You have reached today's practice time limit. Your next available session is tomorrow.");
  });
  it('limit reached on Thursday → next session skips the disabled Friday override', () => {
    const thu = effectiveFor('2026-10-01', W, O);
    const a = accessNow(thu, 12 * 60, 120 * 60, true, nextAvailable('2026-10-01', W, O));
    expect(a.message).toContain('on Saturday, 2026-10-03');
  });
  it('disabled day message; unlimited day never hits a limit; not enforced = allowed with a note', () => {
    const fri = effectiveFor('2026-10-02', W, O);
    expect(accessNow(fri, 12 * 60, 0, true, null).message).toBe('Practice is not scheduled for today.');
    const sun = effectiveFor('2026-10-04', W, O);
    expect(accessNow(sun, 12 * 60, 10 * 3600, true, null)).toMatchObject({ allowed: true, remainingSeconds: null });
    expect(accessNow(fri, 12 * 60, 0, false, null)).toMatchObject({ allowed: true, reason: 'not-enforced' });
  });
});

describe('validation', () => {
  it('rejects bad windows and durations', () => {
    expect(validateDay({ enabled: true, start: '10:00', end: '09:00', limitMinutes: 60 }).errors[0]).toContain('end time must be after start');
    expect(validateDay({ enabled: true, start: '10:00', end: '10:00', limitMinutes: 60 }).errors[0]).toContain("can't be the same");
    expect(validateDay({ enabled: true, start: '10:00', end: '12:00', limitMinutes: 0 }).errors[0]).toContain('more than 0');
    expect(validateDay({ enabled: true, start: '10:00', end: '11:00', limitMinutes: 120 }).errors[0]).toContain('longer than the available window');
    expect(validateDay({ enabled: true, start: '00:00', end: '23:59', limitMinutes: 1440 }).errors).toEqual([]);
    expect(validateDay({ enabled: false, start: '10:00', end: '09:00', limitMinutes: 60 })).toMatchObject({ errors: [], warnings: [expect.stringContaining('disabled')] });
  });
  it('weekly validation names the day; all-disabled warns', () => {
    const bad = { ...W, days: { ...W.days, '3': daySchedule({ start: '18:00', end: '06:00' }) } };
    expect(validateWeekly(bad).errors[0]).toMatch(/^Wednesday/);
    const off = { ...W, mode: 'same' as const, default: daySchedule({ enabled: false }) };
    expect(validateWeekly(off).warnings[0]).toContain('Every day is disabled');
  });
  it('override: no past dates, duplicates warn (replace), custom validated', () => {
    expect(validateOverride({ date: '2026-09-01', kind: 'disabled' }, '2026-09-26', []).errors[0]).toContain('past');
    expect(validateOverride({ date: '2026-10-02', kind: 'disabled' }, '2026-09-26', ['2026-10-02']).warnings[0]).toContain('replaces');
    expect(validateOverride({ date: '2026-10-03', kind: 'custom', start: '09:00', end: '10:00', limitMinutes: 90 }, '2026-09-26', []).errors.length).toBe(1);
  });
});

describe('migration and helpers', () => {
  it('legacy single daily limit becomes every day’s limit, all-day window, study days kept, not enforced', () => {
    const w = fromLegacy(45, [1, 2, 3, 4, 5], 'Asia/Kolkata');
    expect(w.mode).toBe('custom');
    expect(w.enforce).toBe(false);
    expect(w.days['1']).toMatchObject({ enabled: true, start: '00:00', end: '23:59', limitMinutes: 45 });
    expect(w.days['0'].enabled).toBe(false);
    expect(fromLegacy(60, [0, 1, 2, 3, 4, 5, 6], 'UTC').mode).toBe('same');
  });
  it('time-zone aware clock and duration formatting', () => {
    const z = zonedNow('Asia/Kolkata', new Date('2026-09-27T20:00:00Z')); // 01:30 next day in India
    expect(z).toMatchObject({ date: '2026-09-28', minutes: 90, dow: 1 });
    expect(fmtDuration(75 * 60)).toBe('1 hr 15 min');
    expect(fmtDuration(null)).toBe('Unlimited');
  });
});
