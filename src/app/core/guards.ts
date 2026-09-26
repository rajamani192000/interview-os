import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { SettingsService, UserService } from './services/user.service';

/** Signed-in users only. Unknown → /login?next=… */
export const authGuard: CanActivateFn = async (_r, state) => {
  const auth = inject(AuthService), router = inject(Router);
  const u = await auth.whenReady();
  return u ? true : router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** App routes also require a completed onboarding (profile, settings, goal documents). */
export const onboardedGuard: CanActivateFn = async () => {
  const users = inject(UserService), settings = inject(SettingsService), router = inject(Router), auth = inject(AuthService);
  // guards in one canActivate array run concurrently: wait for the auth state ourselves
  if (!(await auth.whenReady())) return router.createUrlTree(['/login']);
  try {
    await Promise.all([users.ensureLoaded(), settings.ensureLoaded()]);
  } catch {
    return true; // offline with empty cache: let the page show its error state instead of looping
  }
  return users.onboarded() ? true : router.createUrlTree(['/onboarding']);
};

/** Admin role = admins/{uid} exists. The UI check is convenience only; firestore.rules enforce it. */
export const adminGuard: CanActivateFn = async (_r, state) => {
  const auth = inject(AuthService), router = inject(Router);
  const u = await auth.whenReady();
  if (!u) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  return (await auth.whenAdminKnown()) ? true : router.createUrlTree(['/app/dashboard'], { queryParams: { denied: 'admin' } });
};

/** Login/register pages redirect signed-in users into the app. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService), router = inject(Router);
  const u = await auth.whenReady();
  return u ? router.createUrlTree(['/app/today']) : true;
};
