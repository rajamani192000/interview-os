import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard, onboardedGuard, practiceGuard } from './core/guards';
import { AboutComponent, FeaturesComponent, LandingComponent, NotFoundComponent, PrivacyComponent, TermsComponent } from './public/public-pages';

const f = (p: Promise<Record<string, unknown>>, name: string) => p.then(m => m[name] as never);

export const routes: Routes = [
  { path: '', component: LandingComponent, title: 'Interview OS — Prepare smarter' },
  { path: 'about', component: AboutComponent, title: 'About · Interview OS' },
  { path: 'features', component: FeaturesComponent, title: 'Features · Interview OS' },
  { path: 'privacy', component: PrivacyComponent, title: 'Privacy · Interview OS' },
  { path: 'terms', component: TermsComponent, title: 'Terms · Interview OS' },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => f(import('./public/auth-pages'), 'LoginComponent'), title: 'Sign in · Interview OS' },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => f(import('./public/auth-pages'), 'RegisterComponent'), title: 'Create account · Interview OS' },
  { path: 'forgot-password', loadComponent: () => f(import('./public/auth-pages'), 'ForgotPasswordComponent'), title: 'Forgot password · Interview OS' },
  { path: 'reset-password', loadComponent: () => f(import('./public/auth-pages'), 'ResetPasswordComponent'), title: 'Reset password · Interview OS' },
  { path: 'onboarding', canActivate: [authGuard], loadComponent: () => f(import('./features/onboarding'), 'OnboardingComponent'), title: 'Setup · Interview OS' },
  {
    path: 'app',
    canActivate: [authGuard, onboardedGuard],
    canActivateChild: [authGuard],
    loadComponent: () => f(import('./shell/shell'), 'ShellComponent'),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'today' },
      { path: 'dashboard', loadComponent: () => f(import('./features/dashboard'), 'DashboardComponent'), title: 'Dashboard' },
      { path: 'today', loadComponent: () => f(import('./features/today'), 'TodayComponent'), title: 'Today' },
      { path: 'practice', canActivate: [practiceGuard], loadComponent: () => f(import('./features/practice'), 'PracticeComponent'), title: 'Practice' },
      { path: 'questions', loadComponent: () => f(import('./features/questions'), 'QuestionsComponent'), title: 'Questions' },
      { path: 'questions/:id', loadComponent: () => f(import('./features/questions'), 'QuestionDetailComponent'), title: 'Question' },
      { path: 'revision', loadComponent: () => f(import('./features/revision'), 'RevisionComponent'), title: 'Revision' },
      { path: 'weak-areas', loadComponent: () => f(import('./features/revision'), 'WeakAreasComponent'), title: 'Weak areas' },
      { path: 'communication', canActivate: [practiceGuard], loadComponent: () => f(import('./features/communication'), 'CommunicationComponent'), title: 'Communication' },
      { path: 'voice', canActivate: [practiceGuard], loadComponent: () => f(import('./features/voice'), 'VoiceComponent'), title: 'Voice interview' },
      { path: 'mock-interview', canActivate: [practiceGuard], loadComponent: () => f(import('./features/mock'), 'MockComponent'), title: 'Mock interview' },
      { path: 'jobs', loadComponent: () => f(import('./features/jobs'), 'JobsComponent'), title: 'Jobs' },
      { path: 'jobs/:id', loadComponent: () => f(import('./features/jobs'), 'JobDetailComponent'), title: 'Job' },
      { path: 'projects', loadComponent: () => f(import('./features/projects'), 'ProjectsComponent'), title: 'Projects' },
      { path: 'notes', loadComponent: () => f(import('./features/projects'), 'NotesComponent'), title: 'Notes' },
      { path: 'progress', loadComponent: () => f(import('./features/progress'), 'ProgressComponent'), title: 'Progress' },
      { path: 'notifications', loadComponent: () => f(import('./features/notifications'), 'NotificationsComponent'), title: 'Notifications' },
      { path: 'settings', loadComponent: () => f(import('./features/settings'), 'SettingsComponent'), title: 'Settings' },
    ],
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    canActivateChild: [adminGuard],
    loadComponent: () => f(import('./shell/shell'), 'ShellComponent'),
    data: { admin: true },
    children: [
      { path: '', loadComponent: () => f(import('./admin/admin'), 'AdminHomeComponent'), title: 'Admin' },
      { path: 'questions', loadComponent: () => f(import('./admin/admin-questions'), 'AdminQuestionsComponent'), title: 'Admin · Questions' },
      { path: 'categories', loadComponent: () => f(import('./admin/admin'), 'AdminCategoriesComponent'), title: 'Admin · Categories' },
      { path: 'topics', loadComponent: () => f(import('./admin/admin'), 'AdminTopicsComponent'), title: 'Admin · Topics' },
      { path: 'settings', loadComponent: () => f(import('./admin/admin'), 'AdminSettingsComponent'), title: 'Admin · Settings' },
    ],
  },
  { path: '**', component: NotFoundComponent, title: 'Not found · Interview OS' },
];
