import { useMemo, useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { MeResponse, ParticipantView, TransactionView } from '@nikount/contracts';
import { isActionAllowed, MAX_TRANSACTION_AMOUNT, parseAmountInput } from '@nikount/core';
import { ApiError } from '../../api/client';
import { useParticipants } from '../../api/participants';
import { useCreateTransaction, useUpdateTransaction } from '../../api/transactions';
import { Button, PageShell, TextField } from '../../components/ui';
import { todayIn } from '../../lib/dates';
import { formatMoney, toAmountInput } from '../../lib/format';
import { useCurrentParticipant } from '../nikount/useCurrentParticipant';

/**
 * Pré-remplissage depuis un virement suggéré : `?from=<id>&to=<id>&amount=<centimes>`.
 * Les valeurs inconnues ou incohérentes sont simplement ignorées.
 */
export function readPrefill(
  params: URLSearchParams,
  activeIds: Set<string>,
): { from: string | null; to: string | null; amount: number | null } {
  const from = params.get('from');
  const to = params.get('to');
  const amountRaw = params.get('amount');
  const amount = amountRaw !== null && /^\d{1,9}$/.test(amountRaw) ? Number(amountRaw) : null;
  return {
    from: from && activeIds.has(from) ? from : null,
    to: to && activeIds.has(to) && to !== from ? to : null,
    amount: amount !== null && amount > 0 && amount <= MAX_TRANSACTION_AMOUNT ? amount : null,
  };
}

/**
 * Saisie d'un remboursement (docs/product.md §5) : une personne en rembourse une autre.
 * Même moteur que les dépenses : payeur = celui qui donne, unique concerné = celui qui reçoit.
 */
export function ReimbursementFormPage({ token, me }: { token: string; me: MeResponse }) {
  const participants = useParticipants(token);

  if (!isActionAllowed('CREATE_REIMBURSEMENT', me.nikount.state)) {
    return (
      <PageShell>
        <BackLink name={me.nikount.name} />
        <p className="mt-8 rounded-xl bg-slate-100 p-4 text-slate-700">
          Ce nikount est clôturé : plus aucun remboursement ne peut être enregistré.
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
  return <ReimbursementForm token={token} me={me} participants={participants.data} />;
}

function BackLink({ name }: { name: string }) {
  return (
    <Link to=".." className="self-start text-sm font-semibold text-brand-700">
      ← {name}
    </Link>
  );
}

/**
 * Formulaire de remboursement. Sans `existing` : création (page complète). Avec : modification
 * par un admin (formulaire seul, à placer dans une page ou un panneau).
 */
export function ReimbursementForm({
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
  const [params] = useSearchParams();
  const currency = me.nikount.currency;
  const existingTo = existing?.shares[0]?.participantId;
  // En modification, les deux personnes d'origine restent proposées même désactivées.
  const active = useMemo(
    () =>
      participants.filter((p) => p.isActive || p.id === existing?.payerId || p.id === existingTo),
    [participants, existing, existingTo],
  );
  const { current } = useCurrentParticipant(token, me, participants);
  const create = useCreateTransaction(token);
  const update = useUpdateTransaction(token);
  const mutation = existing ? update : create;

  const prefill = readPrefill(params, new Set(active.map((p) => p.id)));
  const defaultFrom = existing?.payerId ?? prefill.from ?? current?.id ?? active[0]?.id ?? '';
  const defaultTo = existingTo ?? prefill.to ?? active.find((p) => p.id !== defaultFrom)?.id ?? '';

  // Généré une fois à l'ouverture : un double envoi ne crée qu'un remboursement (idempotence).
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [fromId, setFromId] = useState(defaultFrom);
  const [toId, setToId] = useState(defaultTo);
  const [amountText, setAmountText] = useState(
    existing
      ? toAmountInput(existing.amount)
      : prefill.amount !== null
        ? toAmountInput(prefill.amount)
        : '',
  );
  const [description, setDescription] = useState(existing?.description ?? 'Remboursement');
  const [occurredOn, setOccurredOn] = useState(
    () => existing?.occurredOn ?? todayIn(me.nikount.timezone),
  );
  const [reason, setReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  const amount = parseAmountInput(amountText);
  const amountValid = amount !== null && amount > 0 && amount <= MAX_TRANSACTION_AMOUNT;
  const samePerson = fromId !== '' && fromId === toId;
  const descriptionValid = description.trim().length > 0 && description.trim().length <= 80;
  const name = (id: string) => active.find((p) => p.id === id)?.name ?? '?';

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (!amountValid || samePerson || !fromId || !toId || !descriptionValid) return;

    if (existing) {
      update.mutate(
        {
          id: existing.id,
          body: {
            amount,
            description,
            category: null,
            occurredOn,
            payerId: fromId,
            distribution: { mode: 'EQUAL', participantIds: [toId] },
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
        type: 'REIMBURSEMENT',
        amount,
        description,
        category: null,
        occurredOn,
        payerId: fromId,
        distribution: { mode: 'EQUAL', participantIds: [toId] },
        ...(me.role === 'PARTICIPANT' && current ? { declaredByParticipantId: current.id } : {}),
      },
      {
        onSuccess: (transaction) => {
          void navigate('..', {
            state: {
              flash:
                transaction.status === 'PENDING'
                  ? 'Remboursement enregistré : il comptera dans les soldes une fois validé par un administrateur.'
                  : 'Remboursement enregistré.',
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

  if (active.length < 2) {
    return (
      <PageShell>
        <BackLink name={me.nikount.name} />
        <p className="mt-8 rounded-xl bg-slate-100 p-4 text-slate-700">
          Il faut au moins deux participants actifs pour enregistrer un remboursement.
        </p>
      </PageShell>
    );
  }

  const form = (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-1 flex-col gap-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <PersonSelect
          id="from"
          label="Qui rembourse ?"
          value={fromId}
          onChange={setFromId}
          participants={active}
          currentId={current?.id ?? null}
        />
        <span className="pb-3 text-xl text-slate-400" aria-hidden="true">
          →
        </span>
        <PersonSelect
          id="to"
          label="À qui ?"
          value={toId}
          onChange={setToId}
          participants={active}
          currentId={current?.id ?? null}
        />
      </div>
      {samePerson ? (
        <p className="-mt-3 text-sm text-red-600">On ne se rembourse pas soi-même.</p>
      ) : null}

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
            aria-invalid={showErrors && !amountValid ? true : undefined}
            className="tabular min-h-16 w-full border-0 bg-transparent text-3xl font-bold focus:ring-0 focus:outline-none"
          />
          <span className="text-2xl font-bold text-slate-400">€</span>
        </div>
        {showErrors && !amountValid ? (
          <p className="mt-1 text-sm text-red-600">Montant positif, 2 décimales au plus.</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Libellé"
          value={description}
          maxLength={80}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          {...(showErrors && !descriptionValid ? { error: 'Libellé requis.' } : {})}
        />
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

      {amountValid && !samePerson && fromId && toId ? (
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800" role="status">
          {name(fromId)} rembourse {formatMoney(amount, currency)} à {name(toId)} : {name(toId)}{' '}
          aura {formatMoney(amount, currency)} de moins à recevoir.
        </p>
      ) : null}

      {existing ? (
        <TextField
          label="Motif de la modification (facultatif)"
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
              : 'Enregistrer le remboursement'}
        </Button>
      </div>
    </form>
  );

  if (existing) return form;
  return (
    <PageShell>
      <BackLink name={me.nikount.name} />
      <h1 className="mt-4 text-2xl font-bold">💸 Remboursement</h1>
      <p className="mt-1 text-sm text-slate-600">
        Enregistrez un virement, une remise d’espèces… entre deux participants.
      </p>
      {form}
    </PageShell>
  );
}

function PersonSelect({
  id,
  label,
  value,
  onChange,
  participants,
  currentId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  participants: ParticipantView[];
  currentId: string | null;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="block min-h-12 w-full rounded-xl border-0 bg-white px-3 ring-1 ring-slate-300 ring-inset"
      >
        {participants.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.id === currentId ? ' (moi)' : ''}
            {p.isActive ? '' : ' (désactivé)'}
          </option>
        ))}
      </select>
    </div>
  );
}
