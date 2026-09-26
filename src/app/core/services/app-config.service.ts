import { inject, Injectable, signal } from '@angular/core';
import { DATA_STORE, SERVER_TIME } from '../data/store';
import { LADDER } from '../logic/srs';
import { DEFAULT_TEMPLATES, ReminderTemplates } from '../logic/reminders';
import { clean } from '../util';

/** meta/appSettings — system settings managed by admins, readable by every signed-in user. */
export interface AppConfig {
  announcement?: string;
  ladder: number[]; // revision intervals in days
  defaultNewPerDay: number;
  defaultDailyMinutes: number;
  templates: ReminderTemplates;
  updatedAt?: number;
  updatedBy?: string;
}
export const DEFAULT_CONFIG: AppConfig = { ladder: LADDER, defaultNewPerDay: 3, defaultDailyMinutes: 45, templates: DEFAULT_TEMPLATES };

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private store = inject(DATA_STORE);
  readonly config = signal<AppConfig>(DEFAULT_CONFIG);
  private loaded = false;

  /** One read per app session. Falls back to defaults offline / when unset. */
  async ensureLoaded(force = false) {
    if (this.loaded && !force) return;
    try {
      const c = await this.store.get<Partial<AppConfig>>('meta/appSettings');
      this.config.set({ ...DEFAULT_CONFIG, ...(c || {}), templates: { ...DEFAULT_TEMPLATES, ...(c?.templates || {}) } });
      this.loaded = true;
    } catch { /* keep defaults */ }
  }

  async save(c: AppConfig, uid: string) {
    const ladder = c.ladder.map(Number).filter(n => n > 0).sort((a, b) => a - b);
    if (ladder.length < 3) throw new Error('The revision ladder needs at least 3 increasing intervals.');
    const next = { ...c, ladder };
    await this.store.set('meta/appSettings', clean({ ...next, updatedAt: SERVER_TIME, updatedBy: uid }));
    this.config.set(next);
  }
}
