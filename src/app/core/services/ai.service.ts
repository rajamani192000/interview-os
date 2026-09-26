import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { kv } from '../data/kv';
import { evaluateLocally } from '../logic/scoring';
import { AIProvider, Question } from '../models';
import { AuthService } from './auth.service';
import { SettingsService } from './user.service';

export interface Evaluation {
  score: number; // 0..100
  covered: string[];
  missed: string[];
  feedback: string[];
  followUp?: string;
  provider: AIProvider;
  fellBack?: boolean; // AI failed → local check used
}

export interface InterviewContext {
  role?: string;
  years?: number;
  stack?: string[];
  mode?: string;
}

interface ProviderImpl {
  readonly id: AIProvider;
  readonly label: string;
  complete(system: string, user: string): Promise<string>;
}

const KEY_PREFIX = 'ai.key.';

export const PROVIDERS: { id: AIProvider; label: string; needsKey: boolean; note: string }[] = [
  { id: 'none', label: 'No AI (offline key-point check)', needsKey: false, note: 'Free and private. Compares your answer with the key points of your own model answer.' },
  { id: 'gemini', label: 'Google Gemini (your API key)', needsKey: true, note: 'Google AI Studio offers a free tier. Key stays on this device.' },
  { id: 'claude', label: 'Anthropic Claude (your API key)', needsKey: true, note: 'Paid API usage, separate from a Claude.ai subscription. Key stays on this device.' },
  { id: 'openai', label: 'OpenAI (your API key)', needsKey: true, note: 'Paid API usage. Key stays on this device.' },
  { id: 'local', label: 'Local model (Ollama on this computer)', needsKey: false, note: 'Runs on your own machine. Start Ollama with OLLAMA_ORIGINS set to this site.' },
  { id: 'proxy', label: 'Server proxy (Cloud Function)', needsKey: false, note: 'Key kept in Firebase Functions secrets. Needs the Blaze plan and a deployed function.' },
];

/**
 * AIInterviewService: one interface for Claude / OpenAI / Gemini / local / server proxy, with a
 * no-AI fallback that always works. API keys are the user's own, typed at runtime, kept in memory
 * (or on this device only if they choose "remember"), never written to Firestore or the source.
 */
@Injectable({ providedIn: 'root' })
export class AIInterviewService {
  private settings = inject(SettingsService);
  private auth = inject(AuthService);
  private memKeys = new Map<string, string>();
  readonly lastError = signal('');

  provider(): AIProvider {
    return this.settings.settings().ai.provider;
  }

  async getKey(p: AIProvider): Promise<string> {
    return this.memKeys.get(p) || (await kv.get<string>(KEY_PREFIX + p)) || '';
  }
  async setKey(p: AIProvider, key: string, remember: boolean) {
    this.memKeys.set(p, key.trim());
    if (remember) await kv.set(KEY_PREFIX + p, key.trim());
    else await kv.del(KEY_PREFIX + p);
  }
  async forgetKeys() {
    this.memKeys.clear();
    for (const p of PROVIDERS) await kv.del(KEY_PREFIX + p.id);
  }
  async ready(): Promise<{ ok: boolean; reason?: string }> {
    const p = this.provider();
    if (p === 'none') return { ok: true };
    if (p === 'proxy') return environment.aiProxyUrl ? { ok: true } : { ok: false, reason: 'No proxy URL configured (environment.aiProxyUrl).' };
    if (p === 'local') return { ok: true };
    return (await this.getKey(p)) ? { ok: true } : { ok: false, reason: 'Add your API key in Settings → AI.' };
  }

  private async impl(): Promise<ProviderImpl | null> {
    const s = this.settings.settings().ai;
    const key = await this.getKey(s.provider);
    const post = async (url: string, body: unknown, headers: Record<string, string>) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 45000);
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: { message?: string } }).error?.message || `HTTP ${r.status}`);
        return j as Record<string, unknown>;
      } finally {
        clearTimeout(t);
      }
    };
    switch (s.provider) {
      case 'claude':
        return { id: 'claude', label: 'Claude', complete: async (system, user) => {
          const j = await post('https://api.anthropic.com/v1/messages', { model: s.model || 'claude-sonnet-4-5', max_tokens: 900, system, messages: [{ role: 'user', content: user }] },
            { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
          return ((j['content'] as { text?: string }[]) || []).map(c => c.text || '').join('');
        } };
      case 'openai':
        return { id: 'openai', label: 'OpenAI', complete: async (system, user) => {
          const j = await post('https://api.openai.com/v1/chat/completions', { model: s.model || 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } }, { authorization: `Bearer ${key}` });
          return ((j['choices'] as { message: { content: string } }[]) || [])[0]?.message.content || '';
        } };
      case 'gemini':
        return { id: 'gemini', label: 'Gemini', complete: async (system, user) => {
          const model = s.model || 'gemini-2.0-flash';
          const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json' },
          }, { 'x-goog-api-key': key });
          return ((j['candidates'] as { content: { parts: { text: string }[] } }[]) || [])[0]?.content.parts.map(p => p.text).join('') || '';
        } };
      case 'local':
        return { id: 'local', label: 'Local', complete: async (system, user) => {
          const j = await post((s.localUrl || 'http://localhost:11434') + '/api/chat', { model: s.model || 'llama3.1', stream: false, format: 'json', messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, {});
          return (j['message'] as { content: string })?.content || '';
        } };
      case 'proxy': {
        if (!environment.aiProxyUrl) return null;
        return { id: 'proxy', label: 'Proxy', complete: async (system, user) => {
          const token = await this.auth.idToken();
          const j = await post(environment.aiProxyUrl, { system, user }, { authorization: `Bearer ${token}` });
          return String(j['text'] || '');
        } };
      }
      default:
        return null;
    }
  }

  /** Evaluates an answer. Never throws: falls back to the local key-point check. */
  async evaluate(q: Pick<Question, 'question' | 'answer' | 'keyPoints'>, answer: string, durationSec = 0, ctx: InterviewContext = {}): Promise<Evaluation> {
    const local = () => ({ ...evaluateLocally(q, answer, durationSec), provider: 'none' as AIProvider });
    if (!answer.trim()) return { score: 0, covered: [], missed: q.keyPoints || [], feedback: ['No answer was captured.'], provider: 'none' };
    const p = await this.impl();
    if (!p || !(await this.ready()).ok) return local();
    const system = `You are a strict but fair senior technical interviewer for a ${ctx.role || 'Senior Full-Stack (.NET + Angular)'} role${ctx.years ? `, candidate has ${ctx.years} years experience` : ''}.
Evaluate ONLY against the reference answer and key points provided; do not invent facts about the candidate.
Reply with JSON only: {"score":0-100,"covered":[short strings],"missed":[short strings],"feedback":[max 4 short actionable tips],"followUp":"one realistic follow-up question"}`;
    const user = `Question: ${q.question}\n\nReference answer (the candidate's own notes):\n${q.answer.slice(0, 4000)}\n\nKey points: ${(q.keyPoints || []).join('; ') || '(none)'}\n\nCandidate's answer${durationSec ? ` (spoken, ${durationSec}s)` : ''}:\n${answer.slice(0, 5000)}`;
    try {
      const raw = await p.complete(system, user);
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      this.lastError.set('');
      return {
        score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))),
        covered: arr(j.covered), missed: arr(j.missed), feedback: arr(j.feedback).slice(0, 5),
        followUp: typeof j.followUp === 'string' ? j.followUp : undefined, provider: p.id,
      };
    } catch (e) {
      this.lastError.set((e as Error).message || 'AI request failed');
      return { ...local(), fellBack: true, feedback: [`AI unavailable (${this.lastError()}). Used the offline key-point check.`, ...local().feedback] };
    }
  }

  /** Free-form feedback on a speaking drill. Returns null when no AI is configured. */
  async speakingFeedback(prompt: string, transcript: string, ctx: InterviewContext = {}): Promise<string[] | null> {
    const p = await this.impl();
    if (!p || !(await this.ready()).ok || !transcript.trim()) return null;
    try {
      const raw = await p.complete(`You coach spoken English for technical interviews (${ctx.role || 'Senior Full-Stack Developer'}). Reply JSON only: {"feedback":[max 5 short, specific tips on clarity, structure, confidence and grammar]}. Do not invent facts about the speaker.`, `Prompt: ${prompt}\nTranscript: ${transcript.slice(0, 5000)}`);
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      return arr(j.feedback);
    } catch (e) {
      this.lastError.set((e as Error).message);
      return null;
    }
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 10) : [];
}
