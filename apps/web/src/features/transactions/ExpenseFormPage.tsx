import { useMemo, useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type {
  DistributionMode,
  MeResponse,
  ParticipantView,
  TransactionCategory,
  TransactionView,
} from '@nikount/contracts';
import { isActionAllowed, parseAmountInput } from '@nikount/core';
import { ApiError } from '../../api/client';
import { useParticipants } from '../../api/participants';
import { useCreateTransaction, useUpdateTransaction } from '../../api/transactions';
import { Button, PageShell, TextField } from '../../components/ui';
import { CATEGORIES } from '../../lib/categories';
import { todayIn } from '../../lib/dates';
import { formatMoney, toAmountInput } from '../../lib/format';
import { useCurrentParticipant } from '../nikount/useCurrentParticipant';
import { draftFromShares, previewSplit, type DistributionDraft } from './expense-form';

const MODES: { value: DistributionMode; label: string; unit: string }[] = [
  { value: 'EQUAL', label: 'Égal', unit: '' },
  { value: 'SHARES', label: 'Parts', unit: 'part(s)' },
  { value: 'PERCENT', label: '%', unit: '%' },
  { value: 'AMOUNT', label: 'Montants', unit: '€' },
];

export function ExpenseFormPage({ token, me }: { token: string; me: MeResponse }) {
  const participants = useParticipants(token);

  if (!isActionAllowed('CREATE_EXPENSE', me.nikount.state)) {
    return (
      <PageShell>
        <BackLink name={me.nikount.name} />
        <p className="mt-8 rounded-xl bg-slate-100 p-4 text-slate-700">
          Les nouvelles dépenses ne sont plus acceptées sur ce nikount.
        </p>
      </PageShell>
    );
  }
  if (!participants.data) {
    return (
      <PageShell>
        <BackLink name={me.nikount.name} />
        <p className="m-auto text-slate-500" role="status">
          {participants.isError ? 'Impossible de charger les participants.' : 'Chargement…'}
        </p>
      </PageShell>
    );
  }
  return <ExpenseForm token={token} me={me} participants={participants.data} />;
}

function BackLink({ name }: { name: string }) {
  return (
    <Link to=".." className="self-start text-sm font-semibold text-brand-700">
      ← {name}
    </Link>
  );
}

/**
 * Formulaire de dépense. Sans `existing` : création (page complète). Avec : modification par un
 * admin (formulaire seul, à placer dans une page ou un panneau), qui garde le statut de l'opération.
 */
export function ExpenseForm({
  token,
  me,
  participants,
  existing,
  onSaved,
}: {
  token: string;
  me: MeResponse;
  participants: ParticipantView[];
  existing?: TransactionView;
  onSaved?: (transaction: TransactionView) => void;
}) {
  const navigate = useNavigate();
  const currency = me.nikount.currency;
  // En modification, les personnes déjà présentes restent proposées même désactivées.
  const active = useMemo(() => {
    const present = new Set(
      existing ? [existing.payerId, ...existing.shares.map((s) => s.participantId)] : [],
    );
    return participants.filter((p) => p.isActive || present.has(p.id));
  }, [participants, existing]);
  const { current } = useCurrentParticipant(token, me, participants);
  const create = useCreateTransaction(token);
  const update = useUpdateTransaction(token);
  const mutation = existing ? update : create;
  const initial = existing ? draftFromShares(existing.distributionMode, existing.shares) : null;

  // Généré une fois à l'ouverture : un double envoi ne crée qu'une dépense (idempotence).
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [amountText, setAmountText] = useState(existing ? toAmountInput(existing.amount) : '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [category, setCategory] = useState<TransactionCategory | null>(existing?.category ?? null);
  const [occurredOn, setOccurredOn] = useState(
    () => existing?.occurredOn ?? todayIn(me.nikount.timezone),
  );
  const [payerId, setPayerId] = useState(existing?.payerId ?? current?.id ?? active[0]?.id ?? '');
  const [concerned, setConcerned] = useState<Set<string>>(
    () => initial?.concerned ?? new Set(active.map((p) => p.id)),
  );
  const [mode, setMode] = useState<DistributionMode>(existing?.distributionMode ?? 'EQUAL');
  const [values, setValues] = useState<Record<string, string>>(initial?.values ?? {});
  const [reason, setReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const amount = parseAmountInput(amountText);
  const draft: DistributionDraft = {
    mode,
    concerned: active.filter((p) => concerned.has(p.id)).map((p) => p.id),
    values,
  };
  const preview = previewSplit(amount, draft, currency);
  const amountByParticipant = new Map(
    preview.status === 'ok' ? preview.shares.map((s) => [s.participantId, s.amount]) : [],
  );
  const descriptionValid = description.trim().length > 0 && description.trim().length <= 80;

  function changeMode(next: DistributionMode) {
    setMode(next);
    // Valeurs de départ raisonnables : 1 part chacun, rien pour les % et montants.
    setValues(next === 'SHARES' ? Object.fromEntries(active.map((p) => [p.id, '1'])) : {});
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (amount === null || amount <= 0 || !descriptionValid || preview.status !== 'ok') return;

    if (existing) {
      update.mutate(
        {
          id: existing.id,
          body: {
            amount,
            description,
            category,
            occurredOn,
            payerId,
            distribution: preview.distribution,
            version: existing.version,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          },
        },
        { onSuccess: (transaction) => onSaved?.(transaction) },
      );
      return;
    }

    create.mutate(
      {
        clientRequestId,
        type: 'EXPENSE',
        amount,
        description,
        category,
        occurredOn,
        payerId,
        distribution: preview.distribution,
        ...(me.role === 'PARTICIPANT' && current ? { declaredByParticipantId: current.id } : {}),
      },
      {
        onSuccess: (transaction) => {
          void navigate('..', {
            state: {
              flash:
                transaction.status === 'PENDING'
                  ? 'Dépense ajoutée : elle comptera dans les soldes une fois validée par un administrateur.'
                  : 'Dépense ajoutée.',
            },
          });
        },
      },
    );
  }

  const apiError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'L’envoi a échoué. Vérifiez votre connexion et réessayez.'
        : null;

  const form = (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-1 flex-col gap-5">
      <div>
        <label htmlFor="amount" className="block text-sm font-semibold text-slate-700">
          Montant
        </label>
        <div className="mt-1.5 flex items-center rounded-xl bg-white px-4 ring-1 ring-slate-300 ring-inset focus-within:ring-2 focus-within:ring-brand-700">
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={amountText}
            onChange={(event) => {
              setAmountText(event.target.value);
            }}
            aria-invalid={showErrors && (amount === null || amount <= 0) ? true : undefined}
            className="tabular min-h-16 w-full border-0 bg-transparent text-3xl font-bold focus:ring-0 focus:outline-none"
          />
          <span className="text-2xl font-bold text-slate-400">€</span>
        </div>
        {showErrors && (amount === null || amount <= 0) ? (
          <p className="mt-1 text-sm text-red-600">Montant positif, 2 décimales au plus.</p>
        ) : null}
      </div>

      <TextField
        label="Description"
        placeholder="Restaurant, essence…"
        value={description}
        maxLength={80}
        autoComplete="off"
        onChange={(event) => {
          setDescription(event.target.value);
        }}
        {...(showErrors && !descriptionValid
          ? { error: 'Décrivez la dépense en quelques mots.' }
          : {})}
      />

      <fieldset>
        <legend className="text-sm font-semibold text-slate-700">Catégorie</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={category === c.value}
              onClick={() => {
                setCategory(category === c.value ? null : c.value);
              }}
              className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300 aria-pressed:bg-brand-700 aria-pressed:text-white aria-pressed:ring-brand-700"
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="payer" className="block text-sm font-semibold text-slate-700">
            Payé par
          </label>
          <select
            id="payer"
            value={payerId}
            onChange={(event) => {
              setPayerId(event.target.value);
            }}
            className="block min-h-12 w-full rounded-xl border-0 bg-white px-3 ring-1 ring-slate-300 ring-inset"
          >
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === current?.id ? ' (moi)' : ''}
                {p.isActive ? '' : ' (désactivé)'}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="date" className="block text-sm font-semibold text-slate-700">
            Date
          </label>
          <input
            id="date"
            type="date"
            value={occurredOn}
            required
            onChange={(event) => {
              setOccurredOn(event.target.value);
            }}
            className="block min-h-12 w-full rounded-xl border-0 bg-white px-3 ring-1 ring-slate-300 ring-inset"
          />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-slate-700">Pour qui ?</legend>
        <div
          className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-slate-200 p-1"
          role="group"
          aria-label="Répartition"
        >
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              onClick={() => {
                changeMode(m.value);
              }}
              className="min-h-10 rounded-lg text-sm font-semibold text-slate-600 aria-pressed:bg-white aria-pressed:text-brand-800 aria-pressed:shadow-sm"
            >
              {m.label}
            </button>
          ))}
        </div>

        <ul className="mt-3 divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200">
          {active.map((p) => {
            const checked = concerned.has(p.id);
            const share = amountByParticipant.get(p.id);
            return (
              <li key={p.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <input
                  id={`concerned-${p.id}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(concerned);
                    if (checked) next.delete(p.id);
                    else next.add(p.id);
                    setConcerned(next);
                  }}
                  className="size-5 accent-brand-700"
                />
                <label htmlFor={`concerned-${p.id}`} className="min-w-0 flex-1 truncate">
                  {p.name}
                  {p.isActive ? '' : ' (désactivé)'}
                </label>
                {checked && mode !== 'EQUAL' ? (
                  <input
                    inputMode="decimal"
                    aria-label={`${MODES.find((m) => m.value === mode)?.label ?? ''} pour ${p.name}`}
                    value={values[p.id] ?? ''}
                    placeholder={mode === 'AMOUNT' ? '0,00' : '0'}
                    onChange={(event) => {
                      setValues({ ...values, [p.id]: event.target.value });
                    }}
                    className="tabular w-20 rounded-lg border-0 bg-slate-100 px-2 py-1.5 text-right"
                  />
                ) : null}
                <span
                  className="tabular w-24 text-right font-semibold"
                  data-testid={`share-${p.id}`}
                >
                  {checked && share !== undefined ? formatMoney(share, currency) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
        {preview.status === 'error' ? (
          <p role="status" className="mt-2 text-sm text-amber-700">
            {preview.message}
          </p>
        ) : null}
      </fieldset>

      {existing ? (
        <TextField
          label="Motif de la modification (facultatif)"
          placeholder="Ticket corrigé, oubli…"
          value={reason}
          maxLength={200}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      ) : null}

      {apiError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {apiError}
        </p>
      ) : null}

      <div className="sticky bottom-0 mt-auto bg-slate-50 pt-2 pb-[env(safe-area-inset-bottom)]">
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending
            ? 'Envoi…'
            : existing
              ? 'Enregistrer les modifications'
              : amount
                ? `Ajouter ${formatMoney(amount, currency)}`
                : 'Ajouter la dépense'}
        </Button>
      </div>
    </form>
  );

  if (existing) return form;
  return (
    <PageShell>
      <BackLink name={me.nikount.name} />
      <h1 className="mt-4 text-2xl font-bold">Nouvelle dépense</h1>
      {form}
    </PageShell>
  );
}
