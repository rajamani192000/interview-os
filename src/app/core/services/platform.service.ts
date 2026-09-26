import { Injectable, signal } from '@angular/core';
import { dayKey } from '../util';

/** Client clock corrected by server skew (estimated once per sign-in via a serverTimestamp round trip). */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private skew = 0;
  setSkew(ms: number) {
    // ignore tiny or absurd values
    this.skew = Math.abs(ms) > 60_000 && Math.abs(ms) < 7 * 86400_000 ? ms : 0;
  }
  get skewMs() {
    return this.skew;
  }
  now(): number {
    return Date.now() + this.skew;
  }
  date(): Date {
    return new Date(this.now());
  }
  today(): string {
    return dayKey(this.date());
  }
}

@Injectable({ providedIn: 'root' })
export class NetService {
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
  action?: { label: string; run: () => void };
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private n = 0;
  show(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 4000) {
    const t: Toast = { id: ++this.n, text, kind, action };
    this.toasts.update(l => [...l.slice(-2), t]);
    setTimeout(() => this.dismiss(t.id), action ? ms * 2 : ms);
  }
  good(t: string) { this.show(t, 'good'); }
  bad(t: string) { this.show(t, 'bad', undefined, 6000); }
  dismiss(id: number) {
    this.toasts.update(l => l.filter(x => x.id !== id));
  }
}
