# Interview OS — setup guide

Everything runs on Firebase. The free **Spark** plan is enough for Auth, Firestore and Hosting.
Voice recordings in Storage, push reminders while the app is closed and the server-side AI proxy
need the **Blaze** (pay-as-you-go) plan and are switched off by default.

## 1. Create a Firebase project
1. <https://console.firebase.google.com> → **Add project**.
2. **Project settings → General → Your apps → Web (`</>`)**: register a web app. Copy the config
   (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).

## 2. Enable Authentication
1. **Build → Authentication → Get started**.
2. **Sign-in method**: enable **Email/Password** and **Google** (pick a support email).
3. **Settings → Authorized domains**: add the domain you deploy to (for example
   `yourname.github.io`). `localhost` is there by default.
4. Optional — nicer reset emails: **Templates → Password reset → Customize action URL** →
   `https://<your-domain>/<base>/reset-password`. The app handles `mode=resetPassword` and
   `mode=verifyEmail`. Without this, Firebase's default page is used and also works.

## 3. Enable Firestore
**Build → Firestore Database → Create database** → production mode → pick a region close to you
(for India: `asia-south1`). The region cannot be changed later.

## 4. Enable Storage (optional, Blaze)
**Build → Storage → Get started**. Then set `features.storage: true` in your environment and deploy
`storage.rules`. Without it, recordings can still be kept on the device (Settings → Voice).

## 5. Firebase Cloud Messaging (optional, Blaze)
1. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**. Copy the key.
2. Set `fcmVapidKey`, `firebase.appId`, `firebase.messagingSenderId` and `features.messaging: true`.
3. Deploy the functions (step 8). The `scheduledReminders` function sends the push.
   Browsers never guarantee alarm-like behaviour; in-app reminders work without any of this.

## 6. Create the required indexes
All queries use single-field indexes that Firestore creates automatically. `firestore.indexes.json`
only **removes** indexing from long text fields (answers, transcripts, JDs) to save cost:
```bash
npm i -g firebase-tools && firebase login
cp .firebaserc.example .firebaserc   # put your project id in it
firebase deploy --only firestore:indexes
```

## 7. Deploy the security rules
```bash
firebase deploy --only firestore:rules          # and, if Storage is enabled:  --only storage
```
No CLI? Open **Firestore → Rules**, paste `firestore.rules`, **Publish**. Test in the **Rules
Playground**: `get /users/<your uid>/notes/x` as yourself → allowed; as another uid → denied;
`create /questions/x` as a non-admin → denied.

**Make yourself admin** (needed to import questions): **Firestore → Data → Start collection**
`admins` → Document ID = your user UID (Authentication → Users) → any field, e.g. `role: "admin"`.
Clients can never write to `admins`; only you in the console (or the Admin SDK) can.

## 8. Deploy Cloud Functions (optional, Blaze)
```bash
cd functions && npm install && cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY     # only for the AI proxy
firebase deploy --only functions
```
Put the `aiProxy` URL in `aiProxyUrl` and set `features.functions: true` to offer "Server proxy" in
Settings → AI. Each user is capped at 200 AI calls/day (edit `DAILY_AI_LIMIT`).

## 9. Add the environment configuration
Real values are never committed (`src/environments/environment.ts` is git-ignored). Either
```bash
cp src/environments/environment.example.ts src/environments/environment.ts   # then edit it
```
or create a `.env` file (also git-ignored) and generate it:
```
FIREBASE_API_KEY=...
FIREBASE_PROJECT_ID=...
FIREBASE_APP_ID=...
FIREBASE_MESSAGING_SENDER_ID=...
# optional: FIREBASE_AUTH_DOMAIN, FIREBASE_STORAGE_BUCKET, FCM_VAPID_KEY, AI_PROXY_URL,
#           FEATURE_STORAGE=true, FEATURE_MESSAGING=true, FEATURE_FUNCTIONS=true
```
```bash
npm run env
```
The Firebase *web* config is an identifier that every Firebase web app ships to the browser; your
data is protected by Auth + rules. Recommended: restrict the API key to your domains in
Google Cloud Console → APIs & Services → Credentials.

## 10. Run, test, deploy
```bash
npm install
npm start                 # http://localhost:4200 against your Firebase project
npm run test:unit         # logic tests (SRS, plan, reminders, import, JD mapping, migration, rules mirror)
npm run e2e               # full UI journey on the in-browser demo backend (Playwright)
npm run build:pages       # GitHub Pages build (base href /interview-os/) + 404.html + service worker
npm run build:prod && firebase deploy --only hosting     # or Firebase Hosting
```
Import your questions: sign in as admin → **Admin → Questions → Import** (CSV / JSON / .xlsx),
check the preview (errors, duplicates), confirm. Coming from Interview Coach? **Settings → Data &
account → Import from Interview Coach** brings over attempts, schedules, bookmarks, notes and jobs.
