import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';

/*
 * Full journey on the memory backend. State persists in the browser's localStorage, so the tests
 * share one storage state file and run in order.
 */
test.describe.configure({ mode: 'serial' });
const STATE = 'test-results/state.json';
const USER = { name: 'Rajamani Test', email: 'user@example.test', pw: 'Passw0rd!' };
const ADMIN = { name: 'Admin', email: 'admin@example.test', pw: 'Adm1nPass' };
const BANK = process.env['BANK_FILE'] || '/home/claude/prep/bank_all.json';
const errors: string[] = [];

async function open(page: Page) {
  if (existsSync(STATE)) {
    const s = JSON.parse(readFileSync(STATE, 'utf8'));
    await page.addInitScript(ls => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v as string); sessionStorage.setItem('seeded', '1'); } }, s);
  }
  // headless Chrome has no real speech engine: remove it so the typed fallback is used
  await page.addInitScript(() => { delete (window as any).webkitSpeechRecognition; delete (window as any).SpeechRecognition; });
  page.on('pageerror', e => errors.push(e.message));
}
async function persist(page: Page) {
  const ls = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  writeFileSync(STATE, JSON.stringify(ls));
}
async function register(page: Page, u: typeof USER) {
  await page.goto('/register');
  await page.getByLabel('Name').fill(u.name);
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Password', { exact: true }).fill(u.pw);
  await page.getByLabel('Confirm Password').fill(u.pw);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByLabel('Target salary').fill('₹10 LPA+');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Minimum daily commitment (minutes)').fill('15');
  await page.getByLabel('Reminder mode').selectOption('Strict');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Interview goal').fill('Senior full-stack role');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page).toHaveURL(/app\/dashboard/);
}
async function signIn(page: Page, u: typeof USER) {
  await page.goto('/login');
  await expect(page.getByLabel('Email').or(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).first()).toBeVisible();
  if (/app\/today/.test(page.url())) {
    // a previous test left a session: sign out first so the login path is exercised
    await page.evaluate(() => { const k = 'ios.memory.auth.v1'; const s = JSON.parse(localStorage.getItem(k)!); s.current = null; localStorage.setItem(k, JSON.stringify(s)); });
    await page.goto('/login');
  }
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Password').fill(u.pw);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/app\/today/);
}
async function signOut(page: Page) {
  await page.locator('aside').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('public pages and route protection', async ({ page }) => {
  await open(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Prepare Smarter for Your Senior Full-Stack Interview' })).toBeVisible();
  for (const f of ['Daily Preparation', 'Smart Revision', 'AI Voice Interview', 'Job-Specific Preparation', 'Interview Tracking']) await expect(page.getByRole('heading', { name: f })).toBeVisible();
  for (const p of ['/about', '/features', '/privacy', '/terms', '/forgot-password']) { await page.goto(p); await expect(page.locator('h1')).toBeVisible(); }
  await page.goto('/app/today');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ftoday/);
  await page.goto('/admin/questions');
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('login validation and bad credentials', async ({ page }) => {
  await open(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid email');
  await page.getByLabel('Email').fill('nobody@example.test');
  await page.getByLabel('Password').fill('wrong-pass1');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
});

test('register user → onboarding → empty bank state → sign out clears session', async ({ page }) => {
  await open(page);
  await page.goto('/register');
  await page.getByLabel('Name').fill('X');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Confirm Password').fill('short');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await register(page, USER);
  await page.goto('/app/today');
  await expect(page.getByRole('heading', { name: 'No questions yet' })).toBeVisible();
  // a normal user cannot open admin
  await page.goto('/admin');
  await expect(page).toHaveURL(/app\/dashboard\?denied=admin/);
  await signOut(page);
  await page.goto('/app/today');
  await expect(page).toHaveURL(/login/);
  await persist(page);
});

test('admin imports the question bank (parse → validate → preview → confirm)', async ({ page }) => {
  test.skip(!existsSync(BANK), 'bank file not available');
  await open(page);
  await register(page, ADMIN);
  await page.goto('/admin/questions?import=1');
  await page.locator('input[type=file]').setInputFiles(BANK);
  await expect(page.locator('.stat', { hasText: 'Will import' })).toBeVisible();
  const btn = page.getByRole('button', { name: /Confirm import of \d+ questions/ });
  const n = Number((await btn.textContent())!.match(/\d+/)![0]);
  expect(n).toBeGreaterThan(400);
  await btn.click();
  await expect(page.getByText(/Imported: \d+ new/)).toBeVisible({ timeout: 30000 });
  await page.goto('/admin');
  await expect(page.locator('.stat', { hasText: 'Questions' }).locator('b')).toHaveText(String(n));
  // duplicate import is detected
  await page.goto('/admin/questions?import=1');
  await page.locator('input[type=file]').setInputFiles(BANK);
  await expect(page.locator('.stat', { hasText: 'Duplicates' }).locator('b')).toHaveText(String(n));
  await expect(page.getByRole('button', { name: /Confirm import of 0 questions/ })).toBeDisabled();
  // create a category + archive it
  await page.goto('/admin/categories');
  await page.getByRole('button', { name: '+ New category' }).click();
  await page.getByLabel('Name *').fill('Temp Category');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Temp Category')).toBeVisible();
  await page.locator('.list-item', { hasText: 'Temp Category' }).getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('.list-item', { hasText: 'Temp Category' })).toHaveCount(0);
  await signOut(page);
  await persist(page);
});

test('core journey: START TODAY → questions → communication → voice → complete', async ({ page }) => {
  await open(page);
  await signIn(page, USER);
  await expect(page.getByRole('button', { name: /START TODAY/ })).toBeVisible();
  await page.getByRole('button', { name: /START TODAY/ }).click();
  await expect(page).toHaveURL(/app\/practice\?source=plan/);
  for (let i = 0; i < 10; i++) {
    if (await page.getByText('Session complete').isVisible()) break;
    await page.getByRole('button', { name: 'I answered in my head' }).click();
    await page.getByRole('button', { name: /Good/ }).first().click();
    await expect(page.getByText('Reference answer')).toBeVisible();
    await page.getByRole('button', { name: 'Confidence 4' }).click();
    await page.getByRole('button', { name: 'Save & schedule revision' }).click();
    await expect(page.getByText(/next revision/)).toBeVisible();
    await page.getByRole('button', { name: /Continue|Finish/ }).click();
    await expect(page.getByText('Session complete').or(page.getByRole('button', { name: 'I answered in my head' }))).toBeVisible();
  }
  await expect(page.getByText('Session complete')).toBeVisible();
  await page.getByRole('link', { name: /Next: Communication drill/ }).click();
  await page.getByRole('button', { name: '⌨ Type' }).click();
  await page.locator('textarea').fill('Dependency injection means a class receives its dependencies from outside, for example through the constructor. In my project we registered services in Program.cs with scoped lifetime and replaced them with mocks in unit tests, which made the code easier to test and change.');
  await page.getByRole('button', { name: 'Done' }).click();
  for (const d of ['Clarity', 'Confidence', 'Structure']) await page.locator('.row.between', { hasText: d }).getByRole('button', { name: '4' }).click();
  await page.getByRole('button', { name: 'Save session' }).click();
  await expect(page.getByRole('heading', { name: 'Saved ✓' })).toBeVisible();
  await page.getByRole('link', { name: /Next: Voice interview/ }).click();
  await expect(page).toHaveURL(/app\/voice/);
  await page.getByRole('button', { name: 'Start interview' }).click();
  for (let i = 0; i < 6; i++) {
    if (await page.getByRole('heading', { name: 'Interview summary' }).isVisible()) break;
    await page.locator('textarea').fill('This is my answer with an example from my project where we used it in production to solve a real problem.');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText(/Score \d+\/100/)).toBeVisible();
    await page.getByRole('button', { name: /Next question|Finish interview/ }).click();
    await expect(page.getByRole('heading', { name: 'Interview summary' }).or(page.getByRole('button', { name: 'Submit answer' }))).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Interview summary' })).toBeVisible();
  await page.locator('.field', { hasText: 'How confident' }).getByRole('button', { name: '3' }).click();
  await page.getByRole('button', { name: 'Save interview' }).click();
  await expect(page.getByText('Saved. Bank questions were added')).toBeVisible();
  await page.goto('/app/today');
  await expect(page.getByText("Today's plan is complete")).toBeVisible();
  // revision schedule & progress reflect the work
  await page.goto('/app/revision');
  await expect(page.locator('.list-item').first()).toBeVisible();
  await page.goto('/app/progress');
  await expect(page.locator('.stat', { hasText: 'Questions attempted' }).locator('b')).not.toHaveText('0');
  await expect(page.getByText('First question practised')).toBeVisible();
  await persist(page);
});

test('migrates progress from an Interview Coach backup', async ({ page }) => {
  test.skip(!existsSync(BANK), 'bank file not available');
  const bank = JSON.parse(readFileSync(BANK, 'utf8'));
  const backup = { _backup: { app: 'interview-coach' }, questions: [{ id: bank[5].id, _ref: 1, srs: { step: 4, due: '2026-12-01', attempts: 5, correct: 5, incorrect: 0, lapses: 0, conf: 5, lastResult: 'correct' }, flags: { important: true }, notes: { remember: 'Migrated note text' } }],
    attempts: [{ qid: bank[5].id, d: '2026-09-01', result: 'correct', conf: 5, sec: 40 }], jobs: [{ company: 'OldCo', role: 'Full Stack Dev', status: 'Applied', jd: 'Angular' }] };
  writeFileSync('test-results/old-backup.json', JSON.stringify(backup));
  await open(page);
  await signIn(page, USER);
  await page.goto('/app/settings?tab=data');
  await page.locator('input[type=file]').setInputFiles('test-results/old-backup.json');
  await expect(page.getByText(/1<\/b> scheduled questions|Found:/)).toBeVisible();
  await page.getByRole('button', { name: 'Import into my account' }).click();
  await expect(page.getByText('Import finished.')).toBeVisible();
  await page.goto('/app/notes');
  await expect(page.getByText('Remember: Migrated note text')).toBeVisible();
  await page.goto('/app/jobs');
  await expect(page.getByText('OldCo')).toBeVisible();
  await persist(page);
});

test('question library: filter, bookmark, note', async ({ page }) => {
  await open(page);
  await signIn(page, USER);
  await page.goto('/app/questions');
  await page.getByLabel('Search').fill('dependency injection');
  await page.locator('a.list-item').first().click();
  await page.getByRole('button', { name: 'Interview Tomorrow' }).click();
  await page.getByPlaceholder(/Add a note/).fill('Mention scoped lifetime per request.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Mention scoped lifetime per request.')).toBeVisible();
  await page.goto('/app/questions');
  await page.getByRole('button', { name: /Interview Tomorrow \(1\)/ }).click();
  await expect(page.locator('a.list-item')).toHaveCount(1);
  await page.goto('/app/notes');
  await expect(page.getByText('Mention scoped lifetime per request.')).toBeVisible();
  await persist(page);
});

test('jobs: JD mapping, interview round and countdown', async ({ page }) => {
  await open(page);
  await signIn(page, USER);
  await page.goto('/app/jobs');
  await page.getByRole('button', { name: '+ Add job' }).click();
  await page.getByLabel('Company *').fill('Acme Tech');
  await page.getByLabel('Role *').fill('Senior Full-Stack Developer');
  await page.getByLabel('Job description').fill('ASP.NET Core Web API, C#, Angular, RxJS, SQL Server, Docker, Azure, unit testing with xUnit.');
  const d = new Date(Date.now() + 3 * 86400000);
  await page.getByLabel('Interview date').fill(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/app\/jobs\/.+/);
  await expect(page.getByText('Job description mapping')).toBeVisible();
  await expect(page.locator('.list-item', { hasText: 'Angular' }).first()).toBeVisible();
  await expect(page.locator('.badge', { hasText: /Needs preparation|Partially covered|Covered/ }).first()).toBeVisible();
  await expect(page.locator('.list-item', { hasText: 'Azure' }).getByText('No questions in your bank')).toBeVisible();
  await page.goto('/app/today');
  await expect(page.locator('section', { hasText: 'Upcoming interviews' }).getByText('in 3 days')).toBeVisible();
  await page.goto('/app/dashboard');
  await expect(page.getByText('Interview in 3 days')).toBeVisible();
  await persist(page);
});

test('mock interview and project round', async ({ page }) => {
  await open(page);
  await signIn(page, USER);
  await page.goto('/app/projects');
  await page.getByRole('button', { name: '+ Add project' }).click();
  await page.getByLabel('Project name *').fill('Hospital ERP');
  await page.getByLabel('Your role *').fill('Full-Stack Developer');
  await page.getByLabel('Technology (comma separated)').fill('.NET Core, Angular, SQL Server');
  await page.getByLabel('Architecture').fill('Angular SPA, ASP.NET Core Web API, SQL Server.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hospital ERP' })).toBeVisible();
  await page.goto('/app/mock-interview');
  await page.getByLabel('Read questions aloud').uncheck();
  await page.getByRole('button', { name: 'Start mock interview' }).click();
  await expect(page.getByText(/Technical · 1 of/)).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.locator('textarea').fill('An answer with enough words to be evaluated by the offline key point check in this mock.');
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByRole('button', { name: 'Next →' }).click();
  }
  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(page.getByRole('heading', { name: /Result: \d+\/100/ })).toBeVisible();
  await persist(page);
});

test('recovery mode after missed days (clock moved forward)', async ({ page }) => {
  await page.clock.install({ time: new Date(Date.now() + 6 * 86400000) });
  await open(page);
  await signIn(page, USER);
  await expect(page.getByRole('heading', { name: 'WELCOME BACK' })).toBeVisible();
  await expect(page.getByText("Let's restart with 15 minutes.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'START RECOVERY' })).toBeVisible();
  await expect(page.getByText('Recovery plan')).toBeVisible();
});

test('reminder settings, notifications page, settings validation', async ({ page }) => {
  await open(page);
  await signIn(page, USER);
  await page.goto('/app/settings?tab=reminders');
  await page.getByLabel('Mode').selectOption('Interview Countdown');
  await page.getByLabel('Maximum reminders per day').fill('5');
  await page.getByLabel('Quiet hours from').fill('23:00');
  await page.getByRole('button', { name: 'Save reminders' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Mode')).toHaveValue('Interview Countdown');
  await page.goto('/app/settings?tab=routine');
  await page.getByLabel('Daily study target (min)').fill('5');
  await page.getByRole('button', { name: /Save & rebuild/ }).click();
  await expect(page.getByText('Daily target must be at least 15 minutes.')).toBeVisible();
  await page.goto('/app/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.goto('/app/settings?tab=ai');
  await expect(page.getByText('No AI (offline key-point check)')).toBeVisible();
});

test('password reset flow', async ({ page }) => {
  await open(page);
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
  const code = 'reset-' + createHash('sha256').update(USER.email).digest('hex').slice(0, 8);
  await page.goto(`/reset-password?mode=resetPassword&oobCode=${code}`);
  await page.getByLabel('New password', { exact: true }).fill('NewPassw0rd');
  await page.getByLabel('Confirm new password').fill('NewPassw0rd');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
  await page.goto(`/reset-password?mode=resetPassword&oobCode=${code}`);
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await signIn(page, { ...USER, pw: 'NewPassw0rd' });
  USER.pw = 'NewPassw0rd';
  await persist(page);
});

test('offline indicator and mobile layout', async ({ page, context }) => {
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, USER);
  await expect(page.locator('nav.bottom')).toBeVisible();
  await expect(page.locator('aside')).toBeHidden();
  for (const p of ['/app/today', '/app/dashboard', '/app/questions', '/app/voice', '/app/mock-interview', '/app/progress', '/app/jobs', '/app/settings', '/']) {
    await page.goto(p);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('app-loading')).toHaveCount(0);
    await page.screenshot({ path: `test-results/mobile${p.replace(/\//g, '-') || '-home'}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${p}`).toBeLessThanOrEqual(1);
  }
  await page.goto('/app/today');
  await expect(page.locator('h1').first()).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('header').getByText('Offline')).toBeVisible();
  await context.setOffline(false);
  await page.locator('nav.bottom').getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByText('Weak Areas')).toBeVisible();
});

test('no uncaught page errors during the run', async () => {
  expect(errors.filter(e => !/ResizeObserver/.test(e))).toEqual([]);
});
