/* Domain model. Firestore layout:
 *   users/{uid}                       UserProfile
 *   users/{uid}/settings/main         UserSettings
 *   users/{uid}/goals/main            UserGoal
 *   users/{uid}/attempts/{id}         Attempt
 *   users/{uid}/revisionSchedules/{questionId}  RevisionSchedule
 *   users/{uid}/dailyPlans/{yyyy-mm-dd}         DailyPlan
 *   users/{uid}/studySessions, communicationSessions, voiceSessions, mockInterviews,
 *   users/{uid}/bookmarks/{questionId}, notes, jobs, interviews, projects, achievements, notifications
 *   categories/{id}, topics/{id}, questions/{id}   master data (admin writes only)
 *   meta/masterData                    { version } bumped on every master-data change (client cache key)
 *   admins/{uid}                       presence = admin role (checked by security rules)
 */

export type Ts = number; // epoch ms on the client; server writes use serverTimestamp() and are read back as ms

export interface Audit {
  isActive: boolean;
  isArchived: boolean;
  createdAt?: Ts;
  updatedAt?: Ts;
  createdBy?: string;
  updatedBy?: string;
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Senior';
export const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Senior'];
export type QuestionType = 'Concept' | 'Coding' | 'Scenario' | 'System Design' | 'Behavioral';
export const QUESTION_TYPES: QuestionType[] = ['Concept', 'Coding', 'Scenario', 'System Design', 'Behavioral'];

export interface Category extends Audit {
  id: string;
  name: string;
  slug: string;
  description?: string;
  order: number;
}

export interface Topic extends Audit {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  order: number;
}

export interface Question extends Audit {
  id: string;
  categoryId: string;
  topicId: string;
  question: string;
  answer: string;
  keyPoints: string[];
  difficulty: Difficulty;
  type: QuestionType;
  tags: string[];
  followUps: string[];
  priority: number; // 1 = must know, 2 = important, 3 = optional
  source?: string;
  sourceId?: string; // id from the imported file (e.g. "c01"), used to migrate old-app progress
  explanation?: string;
  seniority?: 'Junior' | 'Mid' | 'Senior' | 'Lead';
  hash: string; // normalized question text hash, used for duplicate detection
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  currentRole?: string;
  currentCompany?: string;
  yearsExperience?: number;
  targetRole?: string;
  targetSalary?: string; // as typed by the user
  primaryStack?: string[];
  onboarded: boolean;
  draft?: { dailyMinutes?: number; preferredTime?: string };
  createdAt?: Ts;
  updatedAt?: Ts;
}

export type ReminderMode = 'Normal' | 'Persistent' | 'Strict' | 'Interview Countdown';
export const REMINDER_MODES: ReminderMode[] = ['Normal', 'Persistent', 'Strict', 'Interview Countdown'];
export type AIProvider = 'none' | 'claude' | 'openai' | 'gemini' | 'local' | 'proxy';

export interface UserSettings {
  dailyMinutes: number;
  minMinutes: number; // minimum daily commitment
  studyDays: number[]; // 0=Sun..6=Sat
  preferredTime: string; // HH:mm local
  newPerDay: number;
  reminders: {
    enabled: boolean;
    mode: ReminderMode;
    quietStart: string; // HH:mm
    quietEnd: string; // HH:mm
    maxPerDay: number;
    snoozeMinutes: number;
  };
  voice: { enabled: boolean; rate: number; voiceName?: string; lang: string; saveRecordings: 'none' | 'device' | 'cloud' };
  ai: { provider: AIProvider; model?: string; localUrl?: string };
  focus: { enabled: boolean; neutralMessages: boolean };
  theme: 'system' | 'light' | 'dark';
  updatedAt?: Ts;
}

export interface UserGoal {
  targetRole: string;
  targetDate?: string; // yyyy-mm-dd
  interviewDate?: string; // next known interview, yyyy-mm-dd
  interviewGoal?: string;
  weeklyQuestionTarget: number;
  focusCategoryIds: string[];
  updatedAt?: Ts;
}

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type PracticeMode = 'recall' | 'type' | 'voice' | 'mock';

export interface Attempt {
  id?: string;
  questionId: string;
  categoryId: string;
  topicId: string;
  mode: PracticeMode;
  rating: Rating;
  score: number; // 0..100
  confidence: number; // 1..5
  durationSec: number;
  answerText?: string;
  date: string; // local yyyy-mm-dd
  createdAt?: Ts;
}

export type SrsStatus = 'New' | 'Learning' | 'Weak' | 'Due' | 'Overdue' | 'Strong' | 'Mastered';
export const SRS_STATUSES: SrsStatus[] = ['New', 'Learning', 'Weak', 'Due', 'Overdue', 'Strong', 'Mastered'];
/** Stored status (time-independent). Due/Overdue are derived from dueDate at read time. */
export type StoredStatus = 'Learning' | 'Weak' | 'Strong' | 'Mastered';

export interface RevisionSchedule {
  id?: string;
  questionId: string;
  categoryId: string;
  topicId: string;
  step: number; // index into interval ladder
  intervalDays: number;
  dueDate: string; // yyyy-mm-dd
  reps: number;
  lapses: number;
  streak: number; // consecutive good/easy
  correct: number;
  incorrect: number;
  confidence?: number; // last self-rated confidence 1..5
  lastRating?: Rating;
  lastReviewed?: string; // yyyy-mm-dd
  status: StoredStatus;
  updatedAt?: Ts;
}

export type PlanItemType = 'revision' | 'weak' | 'new' | 'communication' | 'voice' | 'mock' | 'job-prep';
export interface PlanItem {
  id: string;
  type: PlanItemType;
  refId?: string; // questionId / jobId
  title: string;
  minutes: number;
  done: boolean;
  doneAt?: Ts;
}
export interface DailyPlan {
  date: string;
  mode: 'normal' | 'recovery' | 'interview';
  items: PlanItem[];
  minutesPlanned: number;
  generatedAt?: Ts;
  startedAt?: Ts;
  completedAt?: Ts;
}

export interface StudySession {
  id?: string;
  date: string;
  startedAt: Ts;
  endedAt?: Ts;
  minutes: number;
  questions: number;
  kind: 'practice' | 'revision' | 'plan';
}

export type CommType = 'Self introduction' | 'Explain a project' | 'STAR story' | 'Explain a concept simply' | 'Why this company' | 'Salary & notice discussion' | 'Free talk';
export const COMM_TYPES: CommType[] = ['Self introduction', 'Explain a project', 'STAR story', 'Explain a concept simply', 'Why this company', 'Salary & notice discussion', 'Free talk'];

export interface SpeechMetrics {
  words: number;
  wpm: number;
  fillers: number;
  fillerWords: Record<string, number>;
  longPauses?: number;
}
export const COMM_DIMENSIONS = ['clarity', 'confidence', 'accuracy', 'structure', 'conciseness', 'grammar'] as const;
export type CommDimension = (typeof COMM_DIMENSIONS)[number];
export interface CommunicationSession {
  id?: string;
  type: CommType | 'Technical answer';
  questionId?: string;
  ratings?: Partial<Record<CommDimension, number>>; // self ratings 1..5
  prompt: string;
  transcript: string;
  durationSec: number;
  metrics: SpeechMetrics;
  selfRating: number; // 1..5
  feedback?: string[];
  date: string;
  createdAt?: Ts;
}

export interface InterviewTurn {
  questionId?: string;
  question: string;
  answer: string;
  score: number; // 0..100
  feedback: string[];
  missed: string[];
  durationSec: number;
  recordingRef?: string; // 'device:<key>' or 'cloud:<path>'
}
export interface VoiceSession {
  id?: string;
  mode: 'quick' | 'technical' | 'project' | 'hr' | 'architect' | 'weak';
  provider: AIProvider;
  turns: InterviewTurn[];
  overall: number;
  technicalScore?: number;
  communicationScore?: number;
  confidence?: number;
  weakTopics?: string[];
  suggestions?: string[];
  metrics?: SpeechMetrics;
  date: string;
  createdAt?: Ts;
}

/* ---------- Mock interview v2 (dynamic interviewer) ---------- */
export const MOCK_TYPES = ['Technical', 'HR', 'Managerial', 'Full Mock', 'Company-specific', 'Role-specific'] as const;
export type MockType = (typeof MOCK_TYPES)[number];
export const MOCK_ROLES = ['.NET Developer', 'Angular Developer', 'Full Stack Developer', 'Senior Full Stack Developer', 'Backend Developer', 'Frontend Developer'] as const;
export const EXPERIENCE_LEVELS = ['Fresher', '1–3 years', '3–5 years', '5+ years'] as const;
export type MockStyle = 'Friendly' | 'Professional' | 'Challenging';

export interface MockConfig {
  type: MockType;
  role: string;
  experience: (typeof EXPERIENCE_LEVELS)[number];
  technologies: string[]; // category ids from the user's bank
  difficulty: 'Easy' | 'Medium' | 'Hard';
  durationMin: 15 | 30 | 45 | 60;
  questionCount: number; // main questions (follow-ups are extra)
  style: MockStyle;
  jobId?: string;
  focusTopicIds?: string[]; // "improvement interview" for weak topics
}

/** Internal evaluation of one answer (0..100 each). */
export interface TurnEval {
  score: number; // overall for the turn
  correctness: number;
  completeness: number;
  relevance: number;
  communication: number;
  confidence: number;
  structure: number;
  practical: number;
  examples: boolean;
  missed: string[];
  feedback: string[];
  provider: string;
  followUp?: string; // AI-suggested follow-up (kept for conversation context)
}

export type MockTurnKind = 'intro' | 'question' | 'followup' | 'project' | 'behavioral' | 'wrapup';
export interface MockTurn {
  n: number;
  kind: MockTurnKind;
  prompt: string; // exactly what the interviewer said
  questionId?: string;
  categoryId?: string;
  topicId?: string;
  level?: number; // difficulty level 0..3 when asked
  answer: string;
  idk?: boolean; // "I don't know"
  durationSec: number;
  eval?: TurnEval;
}

export interface MockReport {
  scores: { technical: number | null; problemSolving: number | null; communication: number; confidence: number; project: number | null; overall: number };
  strengths: string[];
  improvements: string[];
  struggled: { prompt: string; questionId?: string; missed: string[]; answer: string; betterAnswer: string }[];
  weakCategories: { categoryId: string; name: string; score: number }[];
  weakTopicIds: string[];
  topicScores: { topicId: string; name: string; score: number }[];
  communicationWeak: boolean;
}

export interface MockInterview {
  id?: string;
  title: string;
  jobId?: string;
  /** v1 (fixed rounds) documents keep these; v2 uses config/turns/report */
  rounds: { name: string; questionIds: string[] }[];
  turns: InterviewTurn[];
  version?: 2;
  config?: MockConfig;
  mturns?: MockTurn[];
  report?: MockReport;
  askedIds?: string[];
  level?: number;
  status: 'in-progress' | 'completed';
  overall?: number;
  strengths?: string[];
  improvements?: string[];
  durationSec: number;
  startedAt?: Ts;
  endedAt?: Ts;
  date: string;
  createdAt?: Ts;
}

/** users/{uid}/skillProgress/{topicId}: rolling scores per topic from mock interviews. */
export interface SkillProgress {
  id?: string;
  topicId: string;
  categoryId: string;
  name: string;
  samples: { date: string; score: number; mockId: string }[];
  avg: number;
  updatedAt?: Ts;
}

export const BOOKMARK_TAGS = ['Bookmark', 'Important', 'Difficult', 'Interview Tomorrow', 'Need Revision'] as const;
export type BookmarkTag = (typeof BOOKMARK_TAGS)[number];
export interface Bookmark {
  id?: string;
  questionId: string;
  tags: BookmarkTag[];
  updatedAt?: Ts;
}

export type NoteRef = 'question' | 'topic' | 'project' | 'interview' | 'job' | 'general';
export interface Note {
  id?: string;
  refType: NoteRef;
  refId?: string;
  questionId?: string;
  title: string;
  body: string;
  tags: string[];
  createdAt?: Ts;
  updatedAt?: Ts;
}

export const JOB_STATUSES = ['Saved', 'Applied', 'Recruiter Contacted', 'Interview Scheduled', 'Technical', 'Managerial', 'HR', 'Offer', 'Rejected', 'Withdrawn'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export interface Job {
  id?: string;
  company: string;
  title: string;
  location?: string;
  url?: string;
  source?: string;
  status: JobStatus;
  salaryNote?: string; // only what the user typed
  jd: string;
  skills: string[];
  appliedOn?: string;
  interviewDate?: string;
  round?: string;
  result?: string;
  nextAction?: string;
  nextActionDate?: string;
  notes?: string;
  archived: boolean;
  createdAt?: Ts;
  updatedAt?: Ts;
}

export interface InterviewRound {
  id?: string;
  jobId?: string;
  company: string;
  round: string;
  date: string; // yyyy-mm-dd
  time?: string; // HH:mm
  mode: 'Online' | 'Onsite' | 'Phone';
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  outcome?: 'Passed' | 'Rejected' | 'Waiting';
  prepQuestionIds: string[];
  notes?: string;
  createdAt?: Ts;
  updatedAt?: Ts;
}

export interface Project {
  id?: string;
  name: string;
  role: string;
  tech: string[];
  responsibilities: string;
  architecture: string;
  problem: string;
  challenges: string;
  solution: string;
  performance: string;
  productionIssues: string;
  impact: string; // achievements: user-provided only; never generated
  talkingPoints: string[];
  linkedQuestionIds: string[];
  createdAt?: Ts;
  updatedAt?: Ts;
}

export interface Achievement {
  id: string; // key
  title: string;
  earnedAt: Ts;
}

export interface AppNotification {
  id?: string;
  title: string;
  body: string;
  kind: 'reminder' | 'interview' | 'system';
  read: boolean;
  link?: string;
  createdAt?: Ts;
}

export interface UserData {
  profile: UserProfile | null;
  settings: UserSettings;
  goal: UserGoal;
}
