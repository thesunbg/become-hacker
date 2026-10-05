import type { ReactNode } from 'react';
import type { MissionState } from '@zero-root/types';
import { useT } from '../i18n';

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-surface ${className}`}>
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-mono text-xs tracking-[0.18em] text-muted uppercase">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-signal/15 text-signal border-signal/40 hover:bg-signal/25',
    ghost: 'bg-raised text-text border-border hover:border-muted',
    danger: 'bg-danger/10 text-danger border-danger/40 hover:bg-danger/20',
  }[variant];

  return (
    <button
      {...props}
      className={`rounded-md border px-3 py-2 font-mono text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-xs tracking-wider text-muted uppercase">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-md border border-border bg-void px-3 py-2 font-mono text-sm text-text placeholder:text-muted/60 focus:border-info focus:outline-none"
      />
      {hint !== undefined && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// Written out rather than interpolated: Tailwind scans source text for class names, so a
// template-built `bg-${tone}` would never be generated.
const METER_TONES = {
  signal: 'bg-signal',
  info: 'bg-info',
  warn: 'bg-warn',
  danger: 'bg-danger',
} as const;

export function Meter({
  percent,
  tone = 'signal',
}: {
  percent: number;
  tone?: keyof typeof METER_TONES;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${METER_TONES[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

const STATE_STYLES: Record<MissionState, string> = {
  LOCKED: 'text-muted border-border',
  AVAILABLE: 'text-info border-info/40',
  STARTED: 'text-warn border-warn/40',
  IN_PROGRESS: 'text-warn border-warn/40',
  COMPLETED: 'text-signal border-signal/40',
  FAILED: 'text-danger border-danger/40',
  ABANDONED: 'text-muted border-border',
};

export function StateBadge({ state }: { state: MissionState }) {
  const t = useT();
  return (
    <span
      className={`rounded border px-2 py-0.5 font-mono text-[11px] tracking-wider uppercase ${STATE_STYLES[state]}`}
    >
      {t(`state.${state}`)}
    </span>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-sm text-danger"
    >
      {children}
    </p>
  );
}
