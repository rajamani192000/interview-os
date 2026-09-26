/** Achievements are earned only from the user's recorded activity. Nothing is pre-granted. */
export interface AchievementStats {
  attempts: number;
  distinctQuestions: number;
  mastered: number;
  currentStreak: number;
  bestStreak: number;
  plansCompleted: number;
  recoveryCompleted: number;
  voiceSessions: number;
  commSessions: number;
  mocks: number;
  jobsApplied: number;
}

export const ACHIEVEMENTS: { id: string; title: string; test: (s: AchievementStats) => boolean }[] = [
  { id: 'first-attempt', title: 'First question practised', test: s => s.attempts >= 1 },
  { id: 'q-25', title: '25 different questions practised', test: s => s.distinctQuestions >= 25 },
  { id: 'q-100', title: '100 different questions practised', test: s => s.distinctQuestions >= 100 },
  { id: 'mastered-10', title: '10 questions mastered', test: s => s.mastered >= 10 },
  { id: 'mastered-50', title: '50 questions mastered', test: s => s.mastered >= 50 },
  { id: 'streak-3', title: '3-day streak', test: s => s.bestStreak >= 3 },
  { id: 'streak-7', title: '7-day streak', test: s => s.bestStreak >= 7 },
  { id: 'streak-30', title: '30-day streak', test: s => s.bestStreak >= 30 },
  { id: 'plan-1', title: 'First full daily plan', test: s => s.plansCompleted >= 1 },
  { id: 'plan-10', title: '10 full daily plans', test: s => s.plansCompleted >= 10 },
  { id: 'comeback', title: 'Came back after a break', test: s => s.recoveryCompleted >= 1 },
  { id: 'voice-1', title: 'First voice interview', test: s => s.voiceSessions >= 1 },
  { id: 'voice-10', title: '10 voice interviews', test: s => s.voiceSessions >= 10 },
  { id: 'speak-5', title: '5 speaking drills', test: s => s.commSessions >= 5 },
  { id: 'mock-1', title: 'First full mock interview', test: s => s.mocks >= 1 },
  { id: 'apply-1', title: 'First application tracked', test: s => s.jobsApplied >= 1 },
];

export function earned(stats: AchievementStats, already: Set<string>) {
  return ACHIEVEMENTS.filter(a => !already.has(a.id) && a.test(stats));
}
