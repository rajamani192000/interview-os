/**
 * Optional Cloud Functions for Interview OS (require the Firebase Blaze plan).
 *
 *  scheduledReminders – every 15 minutes: sends FCM push reminders using the same rules as the
 *                       web app (modes, quiet hours, daily cap, snooze gap, minimum commitment).
 *  aiProxy            – HTTPS endpoint that calls the Anthropic API with a key stored in
 *                       Functions secrets, so no AI key ever reaches the browser.
 *
 * Deploy:  firebase functions:secrets:set ANTHROPIC_API_KEY   then   firebase deploy --only functions
 * The web app works without these; they only add closed-app push and server-side AI.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { decideReminder, DEFAULT_TEMPLATES, ReminderTemplates, UserSettings } from './reminders';

initializeApp();
const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

/** yyyy-mm-dd and a Date whose local fields match the given IANA time zone. */
function localNow(tz: string): { day: string; now: Date } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  const now = new Date(Number(p['year']), Number(p['month']) - 1, Number(p['day']), Number(p['hour']), Number(p['minute']));
  return { day: `${p['year']}-${p['month']}-${p['day']}`, now };
}

export const scheduledReminders = onSchedule({ schedule: 'every 15 minutes', region: 'asia-south1', timeoutSeconds: 120 }, async () => {
  const cfg = (await db.doc('meta/appSettings').get()).data() || {};
  const templates: ReminderTemplates = { ...DEFAULT_TEMPLATES, ...(cfg['templates'] || {}) };
  // only users that registered a device token (collection group query over users/*/devices)
  const devices = await db.collectionGroup('devices').limit(2000).get();
  const byUser = new Map<string, { token: string; tz: string; ref: FirebaseFirestore.DocumentReference }[]>();
  devices.forEach(d => {
    const uid = d.ref.parent.parent?.id;
    if (!uid) return;
    (byUser.get(uid) ?? byUser.set(uid, []).get(uid)!).push({ token: d.get('token'), tz: d.get('tz') || 'Asia/Kolkata', ref: d.ref });
  });
  for (const [uid, toks] of byUser) {
    const settings = (await db.doc(`users/${uid}/settings/main`).get()).data() as UserSettings | undefined;
    if (!settings?.reminders?.enabled) continue;
    const { day, now } = localNow(toks[0].tz);
    const plan = (await db.doc(`users/${uid}/dailyPlans/${day}`).get()).data();
    const items: { done: boolean; minutes: number }[] = plan?.['items'] || [];
    const stateRef = db.doc(`users/${uid}/settings/reminderState`);
    const st = (await stateRef.get()).data() || {};
    const sent = st['day'] === day ? st['sent'] || 0 : 0;
    const goal = (await db.doc(`users/${uid}/goals/main`).get()).data();
    const decision = decideReminder(settings, {
      now, today: day, planComplete: items.length > 0 && items.every(i => i.done), planStarted: items.some(i => i.done),
      minutesDone: items.filter(i => i.done).reduce((n, i) => n + i.minutes, 0), sentToday: sent, lastSentAt: st['day'] === day ? st['lastSentAt'] : undefined,
      interviewDate: goal?.['interviewDate'], isStudyDay: settings.studyDays.includes(now.getDay()),
    }, templates);
    if (!decision.send) continue;
    const res = await getMessaging().sendEachForMulticast({
      tokens: toks.map(t => t.token),
      notification: { title: decision.title, body: decision.body },
      data: { link: 'app/today' },
      webpush: { fcmOptions: { link: 'app/today' }, notification: { requireInteraction: !!decision.urgent, tag: 'ios-reminder' } },
    });
    // drop tokens FCM reports as invalid
    await Promise.all(res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || '') ? toks[i].ref.delete() : null)));
    await stateRef.set({ day, sent: sent + 1, lastSentAt: Date.now() }, { merge: true });
    await db.collection(`users/${uid}/notifications`).add({ title: decision.title, body: decision.body, kind: 'reminder', read: false, link: 'app/today', createdAt: FieldValue.serverTimestamp() });
  }
});

const DAILY_AI_LIMIT = 200;

export const aiProxy = onRequest({ region: 'asia-south1', cors: true, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: { message: 'POST only' } }); return; }
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  let uid: string;
  try { uid = (await getAuth().verifyIdToken(token)).uid; } catch { res.status(401).json({ error: { message: 'Sign in required' } }); return; }
  const { system, user } = req.body || {};
  if (typeof system !== 'string' || typeof user !== 'string' || system.length > 4000 || user.length > 12000) { res.status(400).json({ error: { message: 'Bad request' } }); return; }
  // per-user daily cap (cost control)
  const day = new Date().toISOString().slice(0, 10);
  const usageRef = db.doc(`users/${uid}/settings/aiUsage`);
  const allowed = await db.runTransaction(async tx => {
    const u = (await tx.get(usageRef)).data() || {};
    const n = u['day'] === day ? u['count'] || 0 : 0;
    if (n >= DAILY_AI_LIMIT) return false;
    tx.set(usageRef, { day, count: n + 1 }, { merge: true });
    return true;
  });
  if (!allowed) { res.status(429).json({ error: { message: 'Daily AI limit reached' } }); return; }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY.value(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 900, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = (await r.json()) as { content?: { text?: string }[]; error?: { message?: string } };
  if (!r.ok) { res.status(502).json({ error: { message: j.error?.message || 'AI provider error' } }); return; }
  res.json({ text: (j.content || []).map(c => c.text || '').join('') });
});
