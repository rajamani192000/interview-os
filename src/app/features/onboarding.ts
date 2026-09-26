import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { REMINDER_MODES, ReminderMode } from '../core/models';
import { AppConfigService } from '../core/services/app-config.service';
import { AuthService } from '../core/services/auth.service';
import { CategoryService, MasterDataStore } from '../core/services/master-data.service';
import { DEFAULT_GOAL, DEFAULT_SETTINGS, SettingsService, UserService } from '../core/services/user.service';
import { errorMessage } from '../core/util';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

@Component({
  selector: 'app-onboarding',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main class="page narrow">
    <div class="card stack">
      <div class="row between"><span class="eyebrow">Setup · step {{ step() }} of 3</span><button class="btn ghost sm" (click)="auth.signOut()">Sign out</button></div>
      @switch (step()) {
        @case (1) {
          <h1>About you</h1>
          <div class="field"><label for="n">Name</label><input id="n" class="input" [(ngModel)]="f.name" name="n" /></div>
          <div class="grid two">
            <div class="field"><label for="cr">Current role</label><input id="cr" class="input" [(ngModel)]="f.currentRole" name="cr" placeholder="Full-Stack Developer" /></div>
            <div class="field"><label for="ye">Current experience (years)</label><input id="ye" class="input" type="number" min="0" max="40" step="0.5" [(ngModel)]="f.years" name="ye" /></div>
          </div>
          <div class="field"><label for="tr">Target role</label><input id="tr" class="input" [(ngModel)]="f.targetRole" name="tr" /></div>
          <div class="field"><label for="ts">Target salary</label><input id="ts" class="input" [(ngModel)]="f.targetSalary" name="ts" placeholder="e.g. ₹10 LPA+" /><span class="hint">Only what you type is stored. Nothing is estimated.</span></div>
          <div class="field"><label for="sk">Primary skills (comma separated)</label><input id="sk" class="input" [(ngModel)]="f.skills" name="sk" placeholder=".NET Core, C#, Angular, SQL Server" /></div>
        }
        @case (2) {
          <h1>Your routine</h1>
          <div class="grid two">
            <div class="field"><label for="dm">Daily study target (minutes)</label><input id="dm" class="input" type="number" min="15" max="300" [(ngModel)]="f.dailyMinutes" name="dm" /></div>
            <div class="field"><label for="mm">Minimum daily commitment (minutes)</label><input id="mm" class="input" type="number" min="5" max="120" [(ngModel)]="f.minMinutes" name="mm" /><span class="hint">The smallest session that still counts on a busy day.</span></div>
            <div class="field"><label for="pt">Preferred preparation time</label><input id="pt" class="input" type="time" [(ngModel)]="f.preferredTime" name="pt" /></div>
            <div class="field"><label for="np">New questions per day</label><input id="np" class="input" type="number" min="0" max="20" [(ngModel)]="f.newPerDay" name="np" /></div>
          </div>
          <div class="field"><span class="label">Study days</span><div class="row">
            @for (d of days; track $index) { <button type="button" class="chip" [class.on]="f.studyDays.includes($index)" (click)="toggleDay($index)">{{ d }}</button> }
          </div></div>
          <div class="field"><label for="rm">Reminder mode</label>
            <select id="rm" class="input" [(ngModel)]="f.reminderMode" name="rm">@for (m of modes; track m) { <option [value]="m">{{ m }}</option> }</select>
            <span class="hint">{{ modeHelp[f.reminderMode] }}</span></div>
        }
        @case (3) {
          <h1>Your goal</h1>
          <div class="field"><label for="ig">Interview goal</label><input id="ig" class="input" [(ngModel)]="f.interviewGoal" name="ig" placeholder="Clear senior full-stack interviews at product companies" /></div>
          <div class="grid two">
            <div class="field"><label for="td">Target date (optional)</label><input id="td" class="input" type="date" [(ngModel)]="f.targetDate" name="td" /></div>
            <div class="field"><label for="id">Next interview date (optional)</label><input id="id" class="input" type="date" [(ngModel)]="f.interviewDate" name="id" /></div>
          </div>
          <div class="field"><label for="wq">Weekly question target</label><input id="wq" class="input" type="number" min="1" max="500" [(ngModel)]="f.weekly" name="wq" /></div>
          @if (cats.list().length) {
            <div class="field"><span class="label">Focus categories (optional)</span><div class="row">
              @for (c of cats.list(); track c.id) { <button type="button" class="chip" [class.on]="f.focus.includes(c.id)" (click)="toggleFocus(c.id)">{{ c.name }}</button> }
            </div></div>
          }
        }
      }
      @if (error()) { <div class="banner bad small" role="alert">{{ error() }}</div> }
      <div class="row between">
        @if (step() > 1) { <button class="btn" (click)="step.set(step() - 1)">Back</button> } @else { <span></span> }
        @if (step() < 3) { <button class="btn primary" (click)="next()">Continue</button> }
        @else { <button class="btn primary" (click)="finish()" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Finish setup' }}</button> }
      </div>
    </div>
  </main>`,
})
export class OnboardingComponent implements OnInit {
  auth = inject(AuthService);
  private users = inject(UserService);
  private settings = inject(SettingsService);
  private router = inject(Router);
  private md = inject(MasterDataStore);
  private config = inject(AppConfigService);
  cats = inject(CategoryService);
  step = signal(1);
  busy = signal(false);
  error = signal('');
  days = DAYS;
  modes = REMINDER_MODES;
  modeHelp: Record<ReminderMode, string> = {
    Normal: 'Up to 2 gentle reminders on study days; stops once you reach your minimum.',
    Persistent: 'Every 45 minutes until the plan is done, within your daily cap.',
    Strict: 'Every 15 minutes with escalating messages until done, within your daily cap and quiet hours.',
    'Interview Countdown': 'Extra reminders in the 2 weeks before a stored interview date.',
  };
  f = {
    name: '', currentRole: '', years: 3, targetRole: DEFAULT_GOAL.targetRole, targetSalary: '', skills: '.NET Core, C#, Angular, SQL Server',
    dailyMinutes: DEFAULT_SETTINGS.dailyMinutes, minMinutes: DEFAULT_SETTINGS.minMinutes, preferredTime: DEFAULT_SETTINGS.preferredTime, newPerDay: DEFAULT_SETTINGS.newPerDay,
    studyDays: [...DEFAULT_SETTINGS.studyDays], reminderMode: 'Normal' as ReminderMode,
    interviewGoal: '', targetDate: '', interviewDate: '', weekly: DEFAULT_GOAL.weeklyQuestionTarget, focus: [] as string[],
  };

  async ngOnInit() {
    await this.users.ensureLoaded().catch(() => undefined);
    const p = this.users.profile();
    if (p?.onboarded) { this.router.navigateByUrl('/app/dashboard'); return; }
    this.f.name = p?.displayName || this.auth.user()?.displayName || '';
    if (p?.targetRole) this.f.targetRole = p.targetRole;
    if (p?.targetSalary) this.f.targetSalary = p.targetSalary;
    if (p?.draft?.dailyMinutes) this.f.dailyMinutes = p.draft.dailyMinutes;
    if (p?.draft?.preferredTime) this.f.preferredTime = p.draft.preferredTime;
    this.config.ensureLoaded().then(() => { this.f.newPerDay = this.config.config().defaultNewPerDay; });
    this.md.ensureLoaded().catch(() => undefined);
  }
  toggleDay(i: number) {
    this.f.studyDays = this.f.studyDays.includes(i) ? this.f.studyDays.filter(d => d !== i) : [...this.f.studyDays, i].sort();
  }
  toggleFocus(id: string) {
    this.f.focus = this.f.focus.includes(id) ? this.f.focus.filter(x => x !== id) : [...this.f.focus, id];
  }
  next() {
    this.error.set('');
    if (this.step() === 1) {
      if (this.f.name.trim().length < 2) return this.error.set('Enter your name.');
      if (!this.f.targetRole.trim()) return this.error.set('Enter a target role.');
    }
    if (this.step() === 2) {
      if (this.f.dailyMinutes < 15) return this.error.set('Daily target should be at least 15 minutes.');
      if (this.f.minMinutes < 5 || this.f.minMinutes > this.f.dailyMinutes) return this.error.set('Minimum commitment must be between 5 minutes and your daily target.');
      if (!this.f.studyDays.length) return this.error.set('Pick at least one study day.');
    }
    this.step.set(this.step() + 1);
  }
  async finish() {
    this.error.set('');
    const f = this.f;
    this.busy.set(true);
    try {
      const settings = { ...DEFAULT_SETTINGS, dailyMinutes: +f.dailyMinutes, minMinutes: +f.minMinutes, preferredTime: f.preferredTime, newPerDay: +f.newPerDay, studyDays: f.studyDays, reminders: { ...DEFAULT_SETTINGS.reminders, mode: f.reminderMode } };
      await this.users.completeOnboarding(
        { displayName: f.name.trim(), currentRole: f.currentRole.trim() || undefined, yearsExperience: Number(f.years) || 0, targetRole: f.targetRole.trim(), targetSalary: f.targetSalary.trim() || undefined, primaryStack: f.skills.split(',').map(s => s.trim()).filter(Boolean) },
        settings,
        { ...DEFAULT_GOAL, targetRole: f.targetRole.trim(), interviewGoal: f.interviewGoal.trim() || undefined, targetDate: f.targetDate || undefined, interviewDate: f.interviewDate || undefined, weeklyQuestionTarget: +f.weekly, focusCategoryIds: f.focus },
      );
      this.settings.settings.set(settings);
      await this.router.navigateByUrl('/app/dashboard');
    } catch (e) {
      this.error.set('Could not save your setup: ' + errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
