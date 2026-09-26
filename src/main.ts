import { bootstrapApplication } from '@angular/platform-browser';
import { environment } from './environments/environment';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch(err => console.error(err));

// PWA: offline shell + notifications. Skipped in the memory/e2e build.
if ('serviceWorker' in navigator && environment.production && environment.backend === 'firebase') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => undefined));
}
