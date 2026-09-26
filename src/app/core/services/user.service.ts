import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { BatchOp, DATA_STORE, SERVER_TIME } from '../data/store';
import { UserGoal, UserProfile, UserSettings } from '../models';
import { clean } from '../util';
import { AuthService } from './auth.service';

export const DEFAULT_SETTINGS: UserSettings = {
  dailyMinutes: 45,
  minMinutes: 15,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  preferredTime: '19:00',
  newPerDay: 3,
  reminders: { enabled: true, mode: 'Normal', quietStart: '22:30', quietEnd: '07:00', maxPerDay: 4, snoozeMinutes: 15 },
  voice: { enabled: true, rate: 1, lang: 'en-IN', saveRecordings: 'none' },
  ai: { provider: 'none' },
  focus: { enabled: true, neutralMessages: false },
  theme: 'system',
};
export const DEFAULT_GOAL: UserGoal = { targetRole: 'Senior Full-Stack Developer', weeklyQuestionTarget: 25, focusCategoryIds: [] };

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Profile + goal (users/{uid}, users/{uid}/goals/main). */
@Injectable({ providedIn: 'root' })
export class UserService {
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  readonly profile = signal<UserProfile | null>(null);
  readonly goal = signal<UserGoal>(DEFAULT_GOAL);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  readonly onboarded = computed(() => !!this.profile()?.onboarded);
  private loadedFor: string | null = null;
  private pending: Promise<void> | null = null;

  constructor() {
    effect(() => {
      const uid = this.auth.uid();
      if (!uid) { this.profile.set(null); this.goal.set(DEFAULT_GOAL); this.loadedFor = null; this.state.set('idle'); }
    });
  }

  /** Loads profile and goal once per signed-in user (guards call this). */
  ensureLoaded(): Promise<void> {
    const uid = this.auth.uid();
    if (!uid) return Promise.resolve();
    if (this.loadedFor === uid && this.state() === 'ready') return Promise.resolve();
    if (this.pending) return this.pending;
    this.state.set('loading');
    this.pending = Promise.all([this.store.get<UserProfile>(`users/${uid}`), this.store.get<UserGoal>(`users/${uid}/goals/main`)])
      .then(([p, g]) => {
        this.profile.set(p);
        this.goal.set({ ...DEFAULT_GOAL, ...(g || {}) });
        this.loadedFor = uid;
        this.state.set('ready');
      })
      .catch(e => { this.error.set(String((e as Error).message || e)); this.state.set('error'); throw e; })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  /** Called right after registration: creates users/{uid} with onboarded=false plus optional answers. */
  async createInitialProfile(extra: Partial<UserProfile> & { dailyMinutes?: number; preferredTime?: string }) {
    const u = this.auth.user();
    if (!u) throw new Error('Not signed in');
    const { dailyMinutes, preferredTime, ...rest } = extra;
    const p: UserProfile = clean({ ...rest, uid: u.uid, email: u.email, displayName: extra.displayName || u.displayName, onboarded: false });
    await this.store.set(`users/${u.uid}`, { ...p, draft: clean({ dailyMinutes, preferredTime }), createdAt: SERVER_TIME, updatedAt: SERVER_TIME });
    this.profile.set({ ...p, draft: { dailyMinutes, preferredTime } } as UserProfile);
    this.loadedFor = u.uid;
    this.state.set('ready');
  }

  /** Onboarding: creates UserProfile, UserSettings and UserGoal in one atomic batch. */
  async completeOnboarding(profile: Omit<UserProfile, 'uid' | 'email' | 'onboarded'>, settings: UserSettings, goal: UserGoal, extra: (uid: string) => BatchOp[] = () => []) {
    const u = this.auth.user();
    if (!u) throw new Error('Not signed in');
    const p: UserProfile = { ...profile, uid: u.uid, email: u.email, onboarded: true };
    await this.store.batch([
      { type: 'set', path: `users/${u.uid}`, data: clean({ ...p, createdAt: SERVER_TIME, updatedAt: SERVER_TIME }), merge: true },
      { type: 'set', path: `users/${u.uid}/settings/main`, data: clean({ ...settings, updatedAt: SERVER_TIME }) },
      { type: 'set', path: `users/${u.uid}/goals/main`, data: clean({ ...goal, updatedAt: SERVER_TIME }) },
      ...extra(u.uid),
    ]);
    this.profile.set(p);
    this.goal.set(goal);
    this.loadedFor = u.uid;
    this.state.set('ready');
  }

  async updateProfile(patch: Partial<UserProfile>) {
    const uid = this.auth.uid()!;
    const next = { ...this.profile()!, ...patch };
    await this.store.set(`users/${uid}`, clean({ ...patch, updatedAt: SERVER_TIME }), true);
    this.profile.set(next);
  }

  async updateGoal(patch: Partial<UserGoal>) {
    const uid = this.auth.uid()!;
    const next = { ...this.goal(), ...patch };
    await this.store.set(`users/${uid}/goals/main`, clean({ ...next, updatedAt: SERVER_TIME }));
    this.goal.set(next);
  }
}

/** users/{uid}/settings/main */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private store = inject(DATA_STORE);
  private auth = inject(AuthService);
  readonly settings = signal<UserSettings>(DEFAULT_SETTINGS);
  readonly state = signal<LoadState>('idle');
  private loadedFor: string | null = null;

  constructor() {
    effect(() => {
      const uid = this.auth.uid();
      if (!uid) { this.settings.set(DEFAULT_SETTINGS); this.loadedFor = null; }
    });
    effect(() => this.applyTheme(this.settings().theme));
  }

  async ensureLoaded() {
    const uid = this.auth.uid();
    if (!uid || this.loadedFor === uid) return;
    this.state.set('loading');
    try {
      const s = await this.store.get<UserSettings>(`users/${uid}/settings/main`);
      this.settings.set(merge(DEFAULT_SETTINGS, s || {}));
      this.loadedFor = uid;
      this.state.set('ready');
    } catch (e) {
      this.state.set('error');
      throw e;
    }
  }

  async save(patch: Partial<UserSettings>) {
    const next = merge(this.settings(), patch);
    this.settings.set(next);
    await this.store.set(`users/${this.auth.uid()}/settings/main`, clean({ ...next, updatedAt: SERVER_TIME }));
  }

  private applyTheme(t: UserSettings['theme']) {
    if (typeof document === 'undefined') return;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
}

function merge<T>(base: T, patch: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as object)) {
    if (v === undefined || k === 'id') continue;
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? merge(b, v as object) : v;
  }
  return out as T;
}
