# Interview OS — Senior Full-Stack Interview Preparation

Angular 21 + Firebase (Auth, Firestore, optional Storage / Functions / FCM). Personal preparation
system around **your own** question bank: daily plan → practice → spaced revision → speaking →
voice interview → mock → progress, with job tracking and reminders.

Setup: **[SETUP.md](SETUP.md)** (the 10 steps). Live build: <https://rajamani192000.github.io/interview-os/>

## Architecture

```
src/app
  core/
    models.ts                 domain types + Firestore layout
    logic/                    pure, unit-tested: srs, plan, weak, reminders, importer, jd, analytics,
                              scoring (offline answer check), achievements, migrate (old app → new)
    data/                     DataStore / AuthBackend abstractions
      firebase-backend.ts     Firestore (persistent offline cache), Firebase Auth, Storage
      memory-backend.ts       in-browser fake for demos/e2e, mirrors the rules' ownership checks
      kv.ts                   IndexedDB cache (master data, on-device recordings)
    services/                 AuthService, UserService, SettingsService, QuestionService, CategoryService,
                              TopicService, AttemptService, RevisionService, DailyPlanService,
                              StudySessionService, CommunicationService, VoiceInterviewService,
                              MockInterviewService, JobService, InterviewService, ProjectService,
                              ProgressService, NotificationService, AdminService, AIInterviewService,
                              VoiceService, RecordingService, AppConfigService, MigrationService
    guards.ts                 authGuard, onboardedGuard, adminGuard, guestGuard
  public/                     /, /about, /features, /privacy, /terms, /login, /register, /forgot-password, /reset-password
  features/                   onboarding + every /app/* page
  admin/                      /admin, /admin/questions (CRUD, bulk, import), categories, topics, settings
functions/                    scheduledReminders (FCM), aiProxy (server-side AI key) — Blaze only
firestore.rules, storage.rules, firestore.indexes.json, firebase.json
```

Components never call Firebase directly: every read/write goes through a service → `DataStore`.

## Data: where, who, offline, failure, logout

| Feature | Stored at | Read / write | Offline | On failure | After logout |
|---|---|---|---|---|---|
| Profile, settings, goal | `users/{uid}`, `settings/main`, `goals/main` | owner only | Firestore offline cache | error state + retry | cache wiped |
| Questions, categories, topics | `questions`, `categories`, `topics` (+ `meta/masterData.version`) | read: signed-in; write: admin | IndexedDB copy, refreshed only when version changes | cached copy used | kept (not private) |
| Attempts | `users/{uid}/attempts` (append-only) | owner create/delete, no edits | queued writes | toast + retry button | wiped |
| Revision schedule | `users/{uid}/revisionSchedules/{questionId}` | owner | queued | same batch as attempt (atomic) | wiped |
| Daily plan | `users/{uid}/dailyPlans/{yyyy-mm-dd}` | owner | cached | error state + retry | wiped |
| Study / speaking / voice / mock sessions | `studySessions`, `communicationSessions`, `voiceSessions`, `mockInterviews` | owner | queued | error with retry | wiped |
| Bookmarks, notes | `bookmarks/{questionId}`, `notes` | owner | queued | optimistic, rolled back | wiped |
| Jobs, interviews, projects | `jobs`, `interviews`, `projects` | owner | queued | optimistic, rolled back | wiped |
| Achievements, notifications, weak-area snapshot | `achievements`, `notifications`, `progress/weakAreas` | owner | queued | ignored (recomputed) | wiped |
| Push devices | `users/{uid}/devices/{hash}` | owner (+ Functions) | — | push status "error" | wiped |
| System settings, templates, ladder | `meta/appSettings` | read: signed-in; write: admin | defaults | defaults | — |
| Admin role | `admins/{uid}` | read own; write: console only | — | treated as non-admin | — |
| Recordings | device IndexedDB or `gs://…/users/{uid}/recordings` | owner | device | falls back to device | device copies wiped |
| AI API key | memory, or this device if "remember" | never uploaded | — | offline key-point check | wiped |

Sign-out clears the Firestore offline cache, device recordings and saved AI keys, then reloads.

## Cost control
Master data is cached per device and re-read only when `meta/masterData.version` changes (1 read per
app open). No realtime listeners are left running; lists are bounded (`limit`) and date-ranged
(12 months of attempts). Writes are batched. Long text fields are excluded from indexing.

## Testing
* `npm run test:unit` — 35 tests on the pure logic and the rules mirror.
* `npm run e2e` — 14 Playwright scenarios on the demo backend: route protection, register/onboard,
  login errors, password reset, admin import (preview, duplicates), START TODAY → practice →
  communication → voice → plan complete, bookmarks/notes, JD mapping + interview countdown,
  mock + project round, recovery mode (clock moved 6 days), reminder settings, migration,
  offline badge, mobile layout (no horizontal overflow).
* Real Firebase: rules checked in the Firebase Rules Playground; live sign-in check on the deployed site.

## Honest limits
* Browsers can't ring like a native alarm. Reminders show while the app is open/recent, and via FCM
  push only with the optional function (Blaze).
* Speech recognition exists in Chrome/Edge (and Safari partly); everything has a typing fallback.
* Without AI, answers are scored by key-point coverage against your own model answer.
