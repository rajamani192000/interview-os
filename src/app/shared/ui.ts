import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NetService } from '../core/services/platform.service';
import { SrsStatus } from '../core/models';

@Component({
  selector: 'app-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="card stack" role="status" aria-live="polite">
    <div class="row"><div class="spinner"></div><span class="muted">{{ text() }}</span></div>
    @for (i of lines(); track i) { <div class="skeleton" [style.width.%]="90 - i * 12"></div> }
  </div>`,
})
export class LoadingComponent {
  text = input('Loading…');
  rows = input(3);
  lines = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}

@Component({
  selector: 'app-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="card stack" role="alert">
    <div class="banner bad"><b>{{ title() }}</b><br />{{ message() }}</div>
    @if (!net.online()) { <p class="small muted">You are offline. Data you opened before is still available; new data loads when you reconnect.</p> }
    <div><button class="btn" (click)="retry.emit()">Try again</button></div>
  </div>`,
})
export class ErrorComponent {
  net = inject(NetService);
  title = input('Something went wrong');
  message = input('');
  retry = output();
}

@Component({
  selector: 'app-empty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="card center stack" style="padding:28px 16px">
    <h3>{{ title() }}</h3>
    @if (text()) { <p class="muted small">{{ text() }}</p> }
    <div class="row" style="justify-content:center"><ng-content /></div>
  </div>`,
})
export class EmptyComponent {
  title = input.required<string>();
  text = input('');
}

@Component({
  selector: 'app-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge {{ status() }}">{{ status() }}</span>`,
})
export class StatusBadgeComponent {
  status = input.required<SrsStatus | string>();
}

@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `<header class="row between" style="margin-bottom:14px">
    <div class="grow">
      @if (back()) { <a class="small" [routerLink]="back()">← Back</a> }
      <h1 style="margin:2px 0 0">{{ title() }}</h1>
      @if (subtitle()) { <p class="muted small" style="margin:2px 0 0">{{ subtitle() }}</p> }
    </div>
    <div class="row"><ng-content /></div>
  </header>`,
})
export class PageHeaderComponent {
  title = input.required<string>();
  subtitle = input('');
  back = input<string | null>(null);
}

@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="modal-backdrop" (click)="closed.emit()">
    <div class="modal stack" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
      <div class="row between"><h2 style="margin:0">{{ title() }}</h2><button class="btn ghost sm" (click)="closed.emit()" aria-label="Close">✕</button></div>
      <ng-content />
    </div>
  </div>`,
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class ModalComponent {
  title = input('');
  closed = output();
}

@Component({
  selector: 'app-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="progress" [class.good]="value() >= 100" role="progressbar" [attr.aria-valuenow]="value()" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="value()"></span></div>`,
})
export class BarComponent {
  value = input(0);
}

export const UI = [LoadingComponent, ErrorComponent, EmptyComponent, StatusBadgeComponent, PageHeaderComponent, ModalComponent, BarComponent];
