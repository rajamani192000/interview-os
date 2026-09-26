import { ApplicationConfig, ErrorHandler, inject, Injectable, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { FirebaseAuthBackend, FirebaseBlobStore, FirestoreStore } from './core/data/firebase-backend';
import { MemoryAuthBackend, MemoryStore } from './core/data/memory-backend';
import { AUTH_BACKEND, CLOUD_BLOBS, DATA_STORE } from './core/data/store';
import { ToastService } from './core/services/platform.service';
import { errorMessage } from './core/util';

/** Shows unexpected errors as a toast instead of failing silently. */
@Injectable()
class AppErrorHandler implements ErrorHandler {
  private toast = inject(ToastService);
  private auth = inject(AUTH_BACKEND);
  handleError(e: unknown): void {
    console.error(e);
    const err = (e as { rejection?: unknown })?.rejection ?? e;
    const code = (err as { code?: string })?.code || '';
    // session expired / signed out elsewhere: send to login instead of showing a broken page
    if (/unauthenticated|user-token-expired|requires-recent-login/.test(code) || (code === 'permission-denied' && this.auth.user() === null)) {
      this.toast.show('Your session ended. Please sign in again.');
      if (!location.pathname.endsWith('/login')) location.assign(document.baseURI + 'login');
      return;
    }
    const msg = errorMessage(err);
    if (msg && !/ExpressionChanged|ResizeObserver/.test(msg)) this.toast.bad(msg);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    {
      provide: AUTH_BACKEND,
      useFactory: () => (environment.backend === 'memory' ? new MemoryAuthBackend() : new FirebaseAuthBackend()),
    },
    {
      provide: DATA_STORE,
      useFactory: () => {
        const auth = inject(AUTH_BACKEND);
        const toast = inject(ToastService);
        if (environment.backend === 'memory') return new MemoryStore(() => auth.user()?.uid ?? null, () => environment.memoryAdmins.includes(auth.user()?.email || ''));
        return new FirestoreStore(e => toast.bad('A change could not be saved: ' + errorMessage(e)));
      },
    },
    {
      provide: CLOUD_BLOBS,
      useFactory: () => {
        const auth = inject(AUTH_BACKEND);
        return environment.backend === 'firebase' && environment.features.storage ? new FirebaseBlobStore(() => auth.user()?.uid) : null;
      },
    },
  ],
};
