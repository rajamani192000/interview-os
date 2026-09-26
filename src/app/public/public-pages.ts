import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

export const FEATURES: { title: string; text: string }[] = [
  { title: 'Daily Preparation', text: 'A plan generated every day from your revision schedule, weak areas, time budget and upcoming interviews. One START button.' },
  { title: 'Smart Revision', text: 'Spaced repetition on your own questions: New, Learning, Weak, Due, Overdue, Strong and Mastered.' },
  { title: 'Weak Area Tracking', text: 'Low scores, low confidence and repeated misses roll up into weak topics that feed the next plan.' },
  { title: 'Communication Practice', text: 'Timed spoken or typed answers with filler-word, pace and self-rated clarity, structure and grammar tracking.' },
  { title: 'AI Voice Interview', text: 'The interviewer asks, you answer out loud, it scores and follows up. Works with Claude, OpenAI, Gemini, a local model — or no AI at all.' },
  { title: 'Mock Interviews', text: 'Multi-round mocks built from your bank and tailored to a job description when you pick one.' },
  { title: 'Progress Analytics', text: '7, 30, 90 day and all-time views of accuracy, minutes, streaks, speaking and mock scores.' },
  { title: 'Job-Specific Preparation', text: 'Paste a job description and see which skills are Covered, Partially covered or Need preparation — from your own data.' },
  { title: 'Interview Tracking', text: 'Applications, rounds and interview dates, with a countdown that shifts your daily plan before each interview.' },
];

@Component({
  selector: 'app-public-nav',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<nav class="row between" style="padding:14px 16px;max-width:1040px;margin:0 auto" aria-label="Main">
    <a routerLink="/" class="row" style="gap:8px;color:var(--text)"><img src="icons/icon-192.png" width="28" height="28" alt="" /><b>Interview OS</b></a>
    <div class="row">
      <a class="btn ghost sm" routerLink="/features">Features</a>
      @if (auth.signedIn()) { <a class="btn primary sm" routerLink="/app/today">Open app</a> }
      @else { <a class="btn ghost sm" routerLink="/login">Sign in</a><a class="btn primary sm" routerLink="/register">Get started</a> }
    </div>
  </nav>`,
})
export class PublicNavComponent {
  auth = inject(AuthService);
}

@Component({
  selector: 'app-public-footer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<footer class="page row between small muted" style="padding-bottom:32px;border-top:1px solid var(--border);margin-top:32px">
    <span>Interview OS — personal interview preparation</span>
    <span class="row"><a routerLink="/about">About</a><a routerLink="/features">Features</a><a routerLink="/privacy">Privacy</a><a routerLink="/terms">Terms</a></span>
  </footer>`,
})
export class PublicFooterComponent {}

@Component({
  selector: 'app-landing',
  imports: [RouterLink, PublicNavComponent, PublicFooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav />
  <main class="page" style="padding-bottom:0">
    <section class="card hero stack" style="padding:36px 22px;margin-top:8px">
      <span class="eyebrow">Senior Full-Stack Interview OS</span>
      <h1 style="font-size:clamp(1.8rem,5vw,2.8rem);max-width:760px">Prepare Smarter for Your Senior Full-Stack Interview</h1>
      <p class="muted" style="font-size:1.08rem;max-width:720px">Build consistent daily preparation, strengthen technical knowledge, improve communication, practice mock interviews, and track your interview readiness.</p>
      <div class="row">
        <a class="btn primary big" [routerLink]="auth.signedIn() ? '/app/today' : '/register'">Get Started</a>
        <a class="btn big" routerLink="/login">Sign In</a>
      </div>
      <p class="xs muted">Bring your own questions. The system around them — planning, revision, speaking, mocks and tracking — is what this app does.</p>
    </section>
    <section style="margin-top:28px">
      <h2>What you get</h2>
      <div class="grid three">
        @for (f of features; track f.title) {
          <article class="card"><h3>{{ f.title }}</h3><p class="small muted" style="margin:0">{{ f.text }}</p></article>
        }
      </div>
    </section>
    <section class="card stack" style="margin-top:28px">
      <h2>How a day works</h2>
      <ol class="small" style="margin:0;padding-left:20px;line-height:1.9">
        <li>Open the app — Today shows your plan, streak, due revisions and next interview.</li>
        <li>Press <b>START TODAY</b>: revise due questions, answer new ones, rate yourself.</li>
        <li>Do a short speaking drill and a voice interview question.</li>
        <li>Your revision schedule and weak areas update automatically; tomorrow's plan uses them.</li>
      </ol>
    </section>
  </main>
  <app-public-footer />`,
})
export class LandingComponent {
  auth = inject(AuthService);
  features = FEATURES;
}

@Component({
  selector: 'app-features',
  imports: [RouterLink, PublicNavComponent, PublicFooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav /><main class="page stack">
    <h1>Features</h1>
    @for (f of features; track f.title) { <article class="card"><h3>{{ f.title }}</h3><p class="muted" style="margin:0">{{ f.text }}</p></article> }
    <article class="card"><h3>Also included</h3><ul class="small" style="margin:0;padding-left:18px;line-height:1.8">
      <li>Recovery mode after missed days: a 15-minute restart instead of a backlog.</li>
      <li>Reminders: Normal, Persistent, Strict and Interview Countdown, with quiet hours, caps and snooze.</li>
      <li>Notes and bookmarks (Important, Difficult, Interview Tomorrow, Need Revision).</li>
      <li>Your projects as interview material, JSON/CSV export, installable app with offline shell.</li>
      <li>Admin area for categories, topics and questions with CSV / JSON / Excel import.</li>
    </ul></article>
    <div><a class="btn primary" routerLink="/register">Create your account</a></div>
  </main><app-public-footer />`,
})
export class FeaturesComponent {
  features = FEATURES;
}

@Component({
  selector: 'app-about',
  imports: [PublicNavComponent, PublicFooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav /><main class="page narrow stack">
    <h1>About</h1>
    <p>Interview OS is a personal preparation system for Senior Full-Stack (.NET + Angular) interviews. It does not ship a question bank: you import your own questions, and the app turns them into a daily routine of practice, spaced revision, speaking drills, voice interviews and mocks.</p>
    <p>Everything is stored in Firebase (Authentication, Cloud Firestore and optionally Storage) under your own account. Security rules make sure only you can read your data.</p>
    <p class="small muted">AI features are optional and use your own provider key or a server proxy. Without AI, answers are checked against the key points of your own model answers.</p>
  </main><app-public-footer />`,
})
export class AboutComponent {}

@Component({
  selector: 'app-privacy',
  imports: [PublicNavComponent, PublicFooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav /><main class="page narrow stack">
    <h1>Privacy</h1>
    <h3>What is stored</h3>
    <p>Your account (email, name) in Firebase Authentication. Your profile, settings, goals, attempts, revision schedules, plans, sessions, notes, bookmarks, jobs, interviews and projects in Cloud Firestore under <code>users/&lbrace;your id&rbrace;</code>. Voice recordings are not saved unless you turn that on; then they stay on your device or, if enabled by the owner, in Firebase Storage under your user folder.</p>
    <h3>Who can see it</h3>
    <p>Only you. Firestore and Storage security rules deny every other user. Administrators manage shared question data only; the rules do not give them access to your private data.</p>
    <h3>AI providers</h3>
    <p>If you configure an AI provider, the question, the reference answer and your answer are sent to that provider to be scored. Your API key is kept on this device only, never in Firestore. With "No AI" nothing leaves your account.</p>
    <h3>Export and deletion</h3>
    <p>Settings → Data lets you export everything as JSON/CSV and permanently delete your data and account.</p>
  </main><app-public-footer />`,
})
export class PrivacyComponent {}

@Component({
  selector: 'app-terms',
  imports: [PublicNavComponent, PublicFooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav /><main class="page narrow stack">
    <h1>Terms</h1>
    <p>This is a personal preparation tool provided as is, without warranty. Scores and coverage labels are practice aids based on your own data; they are not a prediction of interview outcomes.</p>
    <p>Browser notifications depend on your device and browser settings and are not guaranteed to behave like native alarms.</p>
    <p>You are responsible for the content you import and for your own AI provider usage and costs.</p>
  </main><app-public-footer />`,
})
export class TermsComponent {}

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, PublicNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-public-nav /><main class="page narrow center stack" style="padding-top:60px">
    <h1>Page not found</h1><p class="muted">The address doesn't match any page.</p>
    <div><a class="btn primary" [routerLink]="auth.signedIn() ? '/app/today' : '/'">Go home</a></div>
  </main>`,
})
export class NotFoundComponent {
  auth = inject(AuthService);
}
