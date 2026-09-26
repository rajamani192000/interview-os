import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../environments/environment';
import { AIProvider, REMINDER_MODES, UserGoal, UserProfile, UserSettings } from '../core/models';
import { AIInterviewService, PROVIDERS } from '../core/services/ai.service';
import { AuthService } from '../core/services/auth.service';
import { CategoryService, MasterDataStore } from '../core/services/master-data.service';
import { NotificationService } from '../core/services/notification.service';
import { DailyPlanService } from '../core/services/plan.service';
import { ToastService } from '../core/services/platform.service';
import { ProgressService } from '../core/services/progress.service';
import { SettingsService, UserService } from '../core/services/user.service';
import { RecordingService, VoiceService } from '../core/services/voice.service';
import { errorMessage } from '../core/util';
import { MigrationResult, OldState } from '../core/logic/migrate';
import { MigrationService } from '../core/services/migration.service';
import { UI } from '../shared/ui';
import { ScheduleSettingsComponent } from './schedule-settings';

type Tab = 'profile' | 'time' | 'routine' | 'reminders' | 'voice' | 'ai' | 'data';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

@Component({
  selector: 'app-settings',
  imports: [FormsModule, ScheduleSettingsComponent, ...UI],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page narrow stack">
    <app-page-header title="Settings" />
    <div class="tabs">@for (t of tabs; track t.id) { <button class="chip" [class.on]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button> }</div>
    @if (!ready()) { <app-loading /> }
    @else {
      @switch (tab()) {
        @case ('profile') {
          <section class="card stack">
            <div class="grid two">
              <div class="field"><label for="n">Name</label><input id="n" class="input" [(ngModel)]="p.displayName" /></div>
              <div class="field"><label for="cr">Current role</label><input id="cr" class="input" [(ngModel)]="p.currentRole" /></div>
              <div class="field"><label for="y">Experience (years)</label><input id="y" class="input" type="number" min="0" step="0.5" [(ngModel)]="p.yearsExperience" /></div>
              <div class="field"><label for="tr">Target role</label><input id="tr" class="input" [(ngModel)]="p.targetRole" /></div>
              <div class="field"><label for="ts">Target salary</label><input id="ts" class="input" [(ngModel)]="p.targetSalary" /></div>
              <div class="field"><label for="sk">Primary skills</label><input id="sk" class="input" [(ngModel)]="skills" /></div>
            </div>
            <h3>Goal</h3>
            <div class="field"><label for="ig">Interview goal</label><input id="ig" class="input" [(ngModel)]="g.interviewGoal" /></div>
            <div class="grid two">
              <div class="field"><label for="td">Target date</label><input id="td" class="input" type="date" [(ngModel)]="g.targetDate" /></div>
              <div class="field"><label for="id">Next interview date</label><input id="id" class="input" type="date" [(ngModel)]="g.interviewDate" /><span class="hint">Turns on the countdown and interview-focused plans.</span></div>
              <div class="field"><label for="wq">Weekly question target</label><input id="wq" class="input" type="number" min="1" [(ngModel)]="g.weeklyQuestionTarget" /></div>
            </div>
            @if (cats.list().length) { <div class="field"><span class="label">Focus categories</span><div class="row">@for (c of cats.list(); track c.id) { <button class="chip" [class.on]="g.focusCategoryIds.includes(c.id)" (click)="toggleFocus(c.id)">{{ c.name }}</button> }</div></div> }
            <div><button class="btn primary" (click)="saveProfile()" [disabled]="busy()">Save profile & goal</button></div>
          </section>
        }
        @case ('time') { <app-schedule-settings /> }
        @case ('routine') {
          <section class="card stack">
            <div class="grid two">
              <div class="field"><label for="dm">Daily study target (min)</label><input id="dm" class="input" type="number" min="15" max="300" [(ngModel)]="s.dailyMinutes" /></div>
              <div class="field"><label for="mm">Minimum daily commitment (min)</label><input id="mm" class="input" type="number" min="5" max="120" [(ngModel)]="s.minMinutes" /></div>
              <div class="field"><label for="pt">Preferred preparation time</label><input id="pt" class="input" type="time" [(ngModel)]="s.preferredTime" /></div>
              <div class="field"><label for="np">New questions per day</label><input id="np" class="input" type="number" min="0" max="20" [(ngModel)]="s.newPerDay" /></div>
            </div>
            <p class="small muted" style="margin:0">Practice days, allowed hours and daily limits are set per day in <button type="button" class="btn sm ghost" style="min-height:0;padding:0 4px" (click)="tab.set('time')">Practice time</button>. The daily target here sizes your plan (capped by today's limit).</p>
            <div class="field"><label for="th">Theme</label><select id="th" class="input" [(ngModel)]="s.theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
            <div><button class="btn primary" (click)="saveSettings(true)" [disabled]="busy()">Save & rebuild today's plan</button></div>
          </section>
        }
        @case ('reminders') {
          <section class="card stack">
            <label class="check"><input type="checkbox" [(ngModel)]="s.reminders.enabled" /> Reminders on</label>
            <div class="field"><label for="rm">Mode</label><select id="rm" class="input" [(ngModel)]="s.reminders.mode">@for (m of modes; track m) { <option [value]="m">{{ m }}</option> }</select>
              <span class="hint">{{ modeHelp[s.reminders.mode] }}</span></div>
            <div class="grid two">
              <div class="field"><label for="rt">Reminder time</label><input id="rt" class="input" type="time" [(ngModel)]="s.preferredTime" /></div>
              <div class="field"><label for="mx">Maximum reminders per day</label><input id="mx" class="input" type="number" min="1" max="8" [(ngModel)]="s.reminders.maxPerDay" /></div>
              <div class="field"><label for="sn">Snooze duration (min)</label><input id="sn" class="input" type="number" min="5" max="180" [(ngModel)]="s.reminders.snoozeMinutes" /></div>
              <div class="field"><label for="mc">Minimum daily commitment (min)</label><input id="mc" class="input" type="number" min="5" max="120" [(ngModel)]="s.minMinutes" /></div>
              <div class="field"><label for="qs">Quiet hours from</label><input id="qs" class="input" type="time" [(ngModel)]="s.reminders.quietStart" /></div>
              <div class="field"><label for="qe">Quiet hours until</label><input id="qe" class="input" type="time" [(ngModel)]="s.reminders.quietEnd" /></div>
            </div>
            <label class="check"><input type="checkbox" [(ngModel)]="s.focus.neutralMessages" /> Neutral wording (doesn't reveal what the app is on the lock screen)</label>
            <div class="banner info small">Notifications: <b>{{ notif.permission() }}</b>.
              @if (notif.permission() === 'default') { <button class="btn sm" (click)="notif.requestPermission()">Allow</button> }
              Web apps can't guarantee alarm-like behaviour: reminders are shown while the app is open or recently used, and via push only when the optional Cloud Function is deployed{{ pushOn ? '' : ' (not enabled in this build)' }}.</div>
            <div><button class="btn primary" (click)="saveSettings(false)" [disabled]="busy()">Save reminders</button></div>
          </section>
        }
        @case ('voice') {
          <section class="card stack">
            <label class="check"><input type="checkbox" [(ngModel)]="s.voice.enabled" /> Include a voice interview item in daily plans</label>
            <div class="small muted">This browser: speech output {{ voice.ttsSupported ? '✓' : '✗' }} · speech input {{ voice.sttSupported ? '✓' : '✗ (type instead)' }} · recording {{ voice.recordSupported ? '✓' : '✗' }}</div>
            <div class="grid two">
              <div class="field"><label for="vl">Language</label><select id="vl" class="input" [(ngModel)]="s.voice.lang"><option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option></select></div>
              <div class="field"><label for="vr">Speech rate</label><input id="vr" class="input" type="number" min="0.6" max="1.5" step="0.1" [(ngModel)]="s.voice.rate" /></div>
            </div>
            @if (voices.length) { <div class="field"><label for="vv">Interviewer voice</label><select id="vv" class="input" [(ngModel)]="s.voice.voiceName"><option [ngValue]="undefined">Default</option>@for (v of voices; track v.name) { <option [value]="v.name">{{ v.name }}</option> }</select></div> }
            <div class="field"><label for="rec">Save answer recordings</label><select id="rec" class="input" [(ngModel)]="s.voice.saveRecordings">
              <option value="none">Don't save audio</option><option value="device">On this device only</option>@if (recordings.cloudAvailable) { <option value="cloud">Firebase Storage (my account)</option> }</select>
              <span class="hint">{{ recordings.cloudAvailable ? '' : 'Cloud storage for recordings needs Firebase Storage (Blaze plan) — enable it in the build to use it.' }}</span></div>
            <div class="row"><button class="btn" (click)="voice.speak('Tell me about yourself and your most recent project.')">🔊 Test voice</button><button class="btn primary" (click)="saveSettings(true)" [disabled]="busy()">Save</button></div>
          </section>
        }
        @case ('ai') {
          <section class="card stack">
            <p class="small muted" style="margin:0">The app works fully without AI. A provider adds interviewer-style scoring and follow-up questions.</p>
            @for (pr of providers; track pr.id) {
              <label class="card slim check" style="align-items:flex-start"><input type="radio" name="ai" [value]="pr.id" [(ngModel)]="s.ai.provider" [disabled]="pr.id === 'proxy' && !proxyOn" />
                <span><b class="small">{{ pr.label }}</b><br /><span class="xs muted">{{ pr.note }}</span></span></label>
            }
            @if (needsKey()) {
              <div class="field"><label for="ak">API key for {{ s.ai.provider }}</label><input id="ak" class="input" type="password" autocomplete="off" [(ngModel)]="key" placeholder="Paste your key" />
                <label class="check small"><input type="checkbox" [(ngModel)]="remember" /> Remember on this device (never uploaded; cleared on sign-out)</label></div>
            }
            @if (s.ai.provider !== 'none') { <div class="field"><label for="am">Model (optional)</label><input id="am" class="input" [(ngModel)]="s.ai.model" placeholder="provider default" /></div> }
            @if (s.ai.provider === 'local') { <div class="field"><label for="lu">Local URL</label><input id="lu" class="input" [(ngModel)]="s.ai.localUrl" placeholder="http://localhost:11434" /></div> }
            @if (aiMsg()) { <div class="banner {{ aiOk() ? 'good' : 'bad' }} small">{{ aiMsg() }}</div> }
            <div class="row"><button class="btn primary" (click)="saveAi()" [disabled]="busy()">Save</button><button class="btn" (click)="testAi()" [disabled]="busy() || s.ai.provider === 'none'">Test</button><button class="btn ghost" (click)="forget()">Forget saved keys</button></div>
          </section>
        }
        @case ('data') {
          <section class="card stack">
            <h3>Account</h3>
            <div class="small">{{ auth.user()?.email }} · {{ auth.user()?.provider === 'google' ? 'Google sign-in' : 'Email & password' }} · {{ auth.user()?.emailVerified ? 'verified' : 'not verified' }}</div>
            <div class="row">@if (auth.user()?.provider === 'password') { <button class="btn sm" (click)="reset()">Email me a password reset link</button> }<button class="btn sm" (click)="auth.signOut()">Sign out</button></div>
          </section>
          <section class="card stack">
            <h3>Import from Interview Coach (previous app)</h3>
            <p class="small muted" style="margin:0">Brings over your recorded attempts, revision schedule, bookmarks, notes and jobs. Questions are matched by their id in your imported bank, or identical wording. Import your question bank first.</p>
            <div class="row"><button class="btn sm" (click)="checkCloud()" [disabled]="busy()">Check this account's old cloud copy</button>
              <label class="btn sm">Choose backup file<input type="file" accept=".json,application/json" hidden (change)="pickBackup($event)" /></label></div>
            @if (migMsg()) { <div class="banner {{ migPreview() ? 'info' : 'warn' }} small">{{ migMsg() }}</div> }
            @if (migPreview(); as m) {
              <div class="small">Found: <b>{{ m.schedules.length }}</b> scheduled questions · <b>{{ m.attempts.length }}</b> attempts · <b>{{ m.bookmarks.length }}</b> bookmarks · <b>{{ m.notes.length }}</b> notes · <b>{{ m.jobs.length }}</b> jobs{{ m.unmatched ? ' · ' + m.unmatched + ' practised questions not in the current bank (skipped)' : '' }}</div>
              <div><button class="btn primary sm" (click)="applyMigration(m)" [disabled]="busy()">{{ busy() ? 'Importing…' : 'Import into my account' }}</button></div>
            }
          </section>
          <section class="card stack">
            <h3>Export</h3>
            <div class="row"><button class="btn" (click)="exportJson()">Export all data (JSON)</button><button class="btn" (click)="exportCsv()">Attempts (CSV)</button></div>
          </section>
          <section class="card stack" style="border-color:var(--bad)">
            <h3>Danger zone</h3>
            <p class="small muted" style="margin:0">Deleting removes every document under your account in Firestore. Export first if you want a copy.</p>
            <label class="field"><span class="label">Type DELETE to confirm</span><input class="input" [(ngModel)]="confirmText" /></label>
            <div class="row"><button class="btn danger" (click)="deleteData(false)" [disabled]="confirmText !== 'DELETE' || busy()">Delete my progress data</button>
              <button class="btn danger solid" (click)="deleteData(true)" [disabled]="confirmText !== 'DELETE' || busy()">Delete data and account</button></div>
          </section>
        }
      }
    }
  </div>`,
})
export class SettingsComponent implements OnInit {
  auth = inject(AuthService);
  settings = inject(SettingsService);
  users = inject(UserService);
  cats = inject(CategoryService);
  notif = inject(NotificationService);
  voice = inject(VoiceService);
  recordings = inject(RecordingService);
  private md = inject(MasterDataStore);
  private ai = inject(AIInterviewService);
  private plan = inject(DailyPlanService);
  private progress = inject(ProgressService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  tabs: { id: Tab; label: string }[] = [{ id: 'profile', label: 'Profile & goal' }, { id: 'time', label: 'Practice time' }, { id: 'routine', label: 'Routine' }, { id: 'reminders', label: 'Reminders' }, { id: 'voice', label: 'Voice' }, { id: 'ai', label: 'AI' }, { id: 'data', label: 'Data & account' }];
  modes = REMINDER_MODES;
  modeHelp: Record<string, string> = {
    Normal: 'Up to 2 reminders on study days; stops once your minimum is met.',
    Persistent: 'Every 45 min until the plan is done, up to your daily maximum.',
    Strict: 'Every 15 min with escalating messages ("starts now" → "still pending" → "complete your minimum"), up to your daily maximum, never in quiet hours.',
    'Interview Countdown': 'Every 30 min in the 2 weeks before an interview; otherwise behaves like Persistent.',
  };
  providers = PROVIDERS;
  days = DAYS;
  proxyOn = !!environment.aiProxyUrl;
  pushOn = environment.features.messaging;
  tab = signal<Tab>('profile');
  ready = signal(false);
  busy = signal(false);
  aiMsg = signal('');
  aiOk = signal(false);
  migMsg = signal('');
  migPreview = signal<MigrationResult | null>(null);
  private migration = inject(MigrationService);
  voices: SpeechSynthesisVoice[] = [];
  s!: UserSettings;
  p!: UserProfile;
  g!: UserGoal;
  skills = '';
  key = '';
  remember = false;
  confirmText = '';

  async ngOnInit() {
    const t = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (t && this.tabs.some(x => x.id === t)) this.tab.set(t);
    await Promise.all([this.settings.ensureLoaded(), this.users.ensureLoaded(), this.md.ensureLoaded().catch(() => undefined)]);
    this.s = structuredClone(this.settings.settings());
    this.p = { ...this.users.profile()! };
    this.g = { ...this.users.goal(), focusCategoryIds: [...this.users.goal().focusCategoryIds] };
    this.skills = (this.p.primaryStack || []).join(', ');
    this.key = await this.ai.getKey(this.s.ai.provider);
    this.voices = this.voice.voices();
    if (!this.voices.length && this.voice.ttsSupported) speechSynthesis.onvoiceschanged = () => (this.voices = this.voice.voices());
    this.ready.set(true);
  }
  needsKey() { return PROVIDERS.find(p => p.id === this.s.ai.provider)?.needsKey ?? false; }
  toggleDay(i: number) { this.s.studyDays = this.s.studyDays.includes(i) ? this.s.studyDays.filter(d => d !== i) : [...this.s.studyDays, i].sort(); }
  toggleFocus(id: string) { this.g.focusCategoryIds = this.g.focusCategoryIds.includes(id) ? this.g.focusCategoryIds.filter(x => x !== id) : [...this.g.focusCategoryIds, id]; }

  private async run(fn: () => Promise<unknown>, ok: string) {
    this.busy.set(true);
    try { await fn(); this.toast.good(ok); } catch (e) { this.toast.bad(errorMessage(e)); } finally { this.busy.set(false); }
  }
  saveProfile() {
    if (!this.p.displayName?.trim()) { this.toast.bad('Name is required.'); return; }
    return this.run(async () => {
      await this.users.updateProfile({ ...this.p, primaryStack: this.skills.split(',').map(x => x.trim()).filter(Boolean) });
      await this.users.updateGoal(this.g);
      await this.plan.regenerate();
    }, 'Saved');
  }
  saveSettings(rebuild: boolean) {
    const s = this.s;
    if (s.dailyMinutes < 15) { this.toast.bad('Daily target must be at least 15 minutes.'); return; }
    if (s.minMinutes < 5 || s.minMinutes > s.dailyMinutes) { this.toast.bad('Minimum commitment must be 5 minutes or more and not above the daily target.'); return; }
    s.reminders.maxPerDay = Math.min(8, Math.max(1, +s.reminders.maxPerDay));
    s.studyDays = this.settings.settings().studyDays; // owned by the practice schedule
    return this.run(async () => { await this.settings.save(s); if (rebuild) await this.plan.regenerate(); }, 'Settings saved');
  }
  saveAi() {
    return this.run(async () => {
      if (this.needsKey()) await this.ai.setKey(this.s.ai.provider as AIProvider, this.key, this.remember);
      await this.settings.save({ ai: this.s.ai });
    }, 'AI settings saved');
  }
  async testAi() {
    await this.saveAi();
    this.busy.set(true);
    const r = await this.ai.evaluate({ question: 'What is dependency injection?', answer: 'Dependency injection supplies an object\'s dependencies from outside, usually via constructor injection and a DI container.', keyPoints: ['dependencies supplied from outside', 'constructor injection', 'container'] }, 'It means passing dependencies in through the constructor instead of creating them inside, and the container resolves them.');
    this.aiOk.set(!r.fellBack && r.provider !== 'none');
    this.aiMsg.set(this.aiOk() ? `Working: ${r.provider} scored the sample answer ${r.score}/100.` : `Not working: ${this.ai.lastError() || 'no provider'} — the offline check will be used.`);
    this.busy.set(false);
  }
  forget() { return this.run(async () => { await this.ai.forgetKeys(); this.key = ''; }, 'Saved keys removed from this device'); }
  reset() { return this.run(() => this.auth.sendReset(this.auth.user()!.email), 'Reset link sent'); }
  exportJson() { return this.run(() => this.progress.exportJson(), 'Export downloaded'); }
  exportCsv() { return this.run(() => this.progress.exportCsv('attempts'), 'Export downloaded'); }
  private async showMigration(old: OldState | null, from: string) {
    if (!old) { this.migPreview.set(null); this.migMsg.set(`No Interview Coach data found in ${from}.`); return; }
    const m = await this.migration.preview(old);
    this.migPreview.set(m);
    this.migMsg.set(`Ready to import from ${from}. Nothing is written until you confirm.`);
  }
  async checkCloud() {
    this.busy.set(true);
    try { await this.showMigration(await this.migration.readCloudCopy(), 'your account'); }
    catch (e) { this.migMsg.set('Could not read the old cloud copy: ' + errorMessage(e)); }
    finally { this.busy.set(false); }
  }
  async pickBackup(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { await this.showMigration(this.migration.parseBackup(await f.text()), f.name); }
    catch (e) { this.migPreview.set(null); this.migMsg.set(errorMessage(e)); }
  }
  async applyMigration(m: MigrationResult) {
    await this.run(() => this.migration.apply(m), 'Previous progress imported');
    this.migPreview.set(null);
    this.migMsg.set('Import finished. Your plan was rebuilt with the imported revision schedule.');
  }

  async deleteData(account: boolean) {
    this.busy.set(true);
    try {
      await this.progress.deleteAllUserData();
      await this.recordings.clearDevice();
      if (account) await this.auth.deleteAccount();
      this.toast.good(account ? 'Account deleted' : 'Your data was deleted');
      await this.auth.signOut();
    } catch (e) {
      this.toast.bad(errorMessage(e));
    } finally { this.busy.set(false); }
  }
}
