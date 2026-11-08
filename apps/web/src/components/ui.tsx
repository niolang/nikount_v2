import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import type { NikountState } from '@nikount/contracts';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white shadow-sm hover:bg-brand-800 disabled:opacity-60',
  secondary:
    'bg-white text-brand-800 ring-1 ring-inset ring-brand-700/30 hover:bg-brand-50 disabled:opacity-60',
  ghost: 'text-brand-700 hover:bg-brand-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

export function TextField({
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | undefined;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="block min-h-12 w-full rounded-xl border-0 bg-white px-4 text-base ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-700 aria-invalid:ring-red-500"
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const stateLabels: Record<NikountState, { label: string; className: string }> = {
  OPEN: { label: 'En cours', className: 'bg-emerald-100 text-emerald-800' },
  SETTLEMENT: { label: 'Règlement', className: 'bg-amber-100 text-amber-800' },
  CLOSED: { label: 'Clôturé', className: 'bg-slate-200 text-slate-700' },
};

export function StateBadge({ state }: { state: NikountState }) {
  const { label, className } = stateLabels[state];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`}>
      {children}
    </section>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Lien affiché avec boutons « Copier » et, si le téléphone le permet, « Partager ». */
export function ShareableLink({
  url,
  shareTitle,
  label,
}: {
  url: string;
  shareTitle: string;
  label: string;
}) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const canShare = typeof navigator.share === 'function';

  return (
    <div className="space-y-3">
      <input
        readOnly
        value={url}
        aria-label={label}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        className="block w-full truncate rounded-xl border-0 bg-slate-100 px-3 py-2.5 font-mono text-sm text-slate-700"
      />
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            void copyText(url).then((ok) => {
              setCopied(ok ? 'ok' : 'failed');
            });
          }}
        >
          {copied === 'ok' ? 'Copié ✓' : 'Copier'}
        </Button>
        {canShare ? (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              navigator.share({ title: shareTitle, url }).catch(() => undefined);
            }}
          >
            Partager
          </Button>
        ) : null}
      </div>
      {copied === 'failed' ? (
        <p className="text-sm text-red-600">Copie impossible : sélectionnez le lien ci-dessus.</p>
      ) : null}
    </div>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      {children}
    </main>
  );
}
