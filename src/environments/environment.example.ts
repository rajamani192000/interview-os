/**
 * Copy this file to `environment.ts` (and `environment.development.ts` if you use `ng serve`)
 * and fill in your own Firebase web-app config, or run `npm run env` with the variables set
 * (see SETUP.md). `environment.ts` is git-ignored: never commit real values.
 *
 * Note: the Firebase *web* config (apiKey, projectId…) is an identifier, not a secret — it ends up
 * in the browser bundle of every Firebase web app. Your data is protected by Firebase Auth +
 * firestore.rules, not by hiding this config. Real secrets (AI provider keys, service accounts)
 * must NEVER go here; they belong in Cloud Functions secrets.
 */
export const environment = {
  production: true,
  appName: 'Interview OS',
  /** 'firebase' for real use. 'memory' = in-browser fake backend for local demos and e2e tests only. */
  backend: 'firebase' as 'firebase' | 'memory',
  firebase: {
    apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_WEB_APP_ID',
  },
  /** Features that need the Firebase Blaze plan. Leave false on the free Spark plan. */
  features: {
    storage: false, // voice recordings in Firebase Storage (otherwise kept on the device only)
    messaging: false, // FCM push (needs appId + fcmVapidKey + deployed functions to send)
    functions: false, // Cloud Functions (AI proxy, scheduled reminders)
  },
  fcmVapidKey: '',
  /** HTTPS URL of the deployed `aiProxy` Cloud Function (optional, Blaze). */
  aiProxyUrl: '',
  /** Memory backend only: emails treated as admin in local demo/e2e mode. */
  memoryAdmins: [] as string[],
};
