import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { kv } from '../data/kv';
import { BlobStore, CLOUD_BLOBS } from '../data/store';
import { SettingsService } from './user.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

export interface ListenSession {
  readonly text: ReturnType<typeof signal<string>>;
  readonly interim: ReturnType<typeof signal<string>>;
  readonly active: ReturnType<typeof signal<boolean>>;
  readonly error: ReturnType<typeof signal<string>>;
  stop(): Promise<{ text: string; durationSec: number; audio?: Blob }>;
}

/**
 * VoiceService: text-to-speech, speech-to-text and optional recording, with graceful fallbacks.
 * Every screen that uses it also offers typing, so nothing depends on speech support.
 */
@Injectable({ providedIn: 'root' })
export class VoiceService {
  private settings = inject(SettingsService);
  readonly speaking = signal(false);

  get ttsSupported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
  get sttSupported() { return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition); }
  get recordSupported() { return typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia; }

  voices(): SpeechSynthesisVoice[] {
    return this.ttsSupported ? speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')) : [];
  }

  speak(text: string): Promise<void> {
    if (!this.ttsSupported || !text) return Promise.resolve();
    const v = this.settings.settings().voice;
    return new Promise(res => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = v.rate || 1;
      u.lang = v.lang || 'en-IN';
      const voice = speechSynthesis.getVoices().find(x => x.name === v.voiceName);
      if (voice) u.voice = voice;
      const done = () => { this.speaking.set(false); res(); };
      u.onend = done;
      u.onerror = done;
      this.speaking.set(true);
      speechSynthesis.speak(u);
      // some browsers never fire onend: safety timeout by length
      setTimeout(done, Math.min(60000, 2000 + text.length * 90));
    });
  }
  stopSpeaking() {
    if (this.ttsSupported) speechSynthesis.cancel();
    this.speaking.set(false);
  }

  async micPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return p.state as 'granted' | 'denied' | 'prompt';
    } catch {
      return 'unknown';
    }
  }

  /** Starts listening. Auto-restarts when the browser stops early (Android), until stop() is called. */
  listen(opts: { record?: boolean } = {}): ListenSession {
    const text = signal(''), interim = signal(''), active = signal(true), error = signal('');
    const started = Date.now();
    let stopped = false;
    let finalText = '';
    let rec: SR = null;
    let media: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    const chunks: Blob[] = [];
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    const startRec = () => {
      if (!Ctor) { error.set('Speech recognition is not supported in this browser. Type your answer instead.'); active.set(false); return; }
      rec = new Ctor();
      rec.lang = this.settings.settings().voice.lang || 'en-IN';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        let fin = '', tmp = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) fin += r[0].transcript + ' ';
          else tmp += r[0].transcript;
        }
        if (fin) { finalText = (finalText + ' ' + fin).replace(/\s+/g, ' ').trim(); text.set(finalText); }
        interim.set(tmp);
      };
      rec.onerror = (e: any) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { error.set('Microphone permission is blocked. Allow it in the browser site settings, or type your answer.'); stopped = true; active.set(false); }
        else if (e.error === 'network') error.set('Speech recognition needs an internet connection in this browser. You can type instead.');
        else if (e.error === 'audio-capture') { error.set('No microphone found.'); stopped = true; active.set(false); }
      };
      rec.onend = () => {
        if (!stopped) { try { rec.start(); } catch { active.set(false); } }
        else active.set(false);
      };
      try { rec.start(); } catch { /* already started */ }
    };
    startRec();

    if (opts.record && this.recordSupported) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
        if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        media = new MediaRecorder(s);
        media.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
        media.start(1000);
      }).catch(() => undefined);
    }

    return {
      text, interim, active, error,
      stop: () => new Promise(res => {
        stopped = true;
        try { rec?.stop(); } catch { /* ignore */ }
        const finish = () => {
          stream?.getTracks().forEach(t => t.stop());
          const t = (finalText + ' ' + interim()).trim();
          active.set(false);
          res({ text: t, durationSec: Math.round((Date.now() - started) / 1000), audio: chunks.length ? new Blob(chunks, { type: chunks[0].type || 'audio/webm' }) : undefined });
        };
        if (media && media.state !== 'inactive') { media.onstop = () => setTimeout(finish, 50); media.stop(); }
        else setTimeout(finish, 400); // let the last result arrive
      }),
    };
  }
}

/** Where recordings go: nowhere (default), this device (IndexedDB) or Firebase Storage (Blaze). */
@Injectable({ providedIn: 'root' })
export class RecordingService {
  private settings = inject(SettingsService);
  private cloud = inject(CLOUD_BLOBS, { optional: true }) as BlobStore | null;

  get cloudAvailable() { return !!this.cloud && environment.features.storage; }

  async save(key: string, blob: Blob | undefined): Promise<string | undefined> {
    if (!blob) return undefined;
    const where = this.settings.settings().voice.saveRecordings;
    if (where === 'none') return undefined;
    if (where === 'cloud' && this.cloudAvailable) {
      try { return await this.cloud!.put(key + '.webm', blob); } catch { /* fall back to device */ }
    }
    await kv.set('rec.' + key, blob);
    return 'device:' + key;
  }
  async load(ref?: string): Promise<Blob | null> {
    if (!ref) return null;
    if (ref.startsWith('device:')) return (await kv.get<Blob>('rec.' + ref.slice(7))) || null;
    if (ref.startsWith('cloud:') && this.cloud) return this.cloud.get(ref);
    return null;
  }
  async clearDevice() {
    await kv.clearPrefix('rec.');
  }
}
