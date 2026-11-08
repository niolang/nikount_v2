import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type {
  MeResponse,
  ParticipantView,
  TransactionCategory,
  TransactionView,
} from '@nikount/contracts';
import { isActionAllowed, isStatusActionAllowedInState } from '@nikount/core';
import { ApiError } from '../../api/client';
import { useParticipants } from '../../api/participants';
import {
  useBulkStatus,
  useTransactions,
  useUpdateTransaction,
  type StatusActionPath,
} from '../../api/transactions';
import { Button } from '../../components/ui';
import { CATEGORIES, transactionEmoji } from '../../lib/categories';
import { formatShortDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import {
  activeFilterCount,
  bulkAvailability,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterOperations,
  isEditable,
  nextSort,
  sortOperations,
  updateBodyFrom,
  type OperationFilters,
  type SortKey,
  type SortState,
} from '../../lib/operations';
import { statusErrorMessage } from '../review/status-errors';
import { TransactionEditor } from '../transactions/EditTransaction';
import { TransactionDetail } from '../transactions/TransactionDetailPage';

const STATUS_LABELS: Record<TransactionView['status'], { label: string; className: string }> = {
  PENDING: { label: 'En attente', className: 'bg-amber-100 text-amber-800' },
  VALIDATED: { label: 'Validée', className: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Refusée', className: 'bg-slate-200 text-slate-600' },
  CANCELLED: { label: 'Annulée', className: 'bg-slate-200 text-slate-600' },
};

/** Message lisible pour un échec de modification en ligne. */
function editErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'VERSION_CONFLICT':
        return 'Quelqu’un a modifié cette opération entre-temps : la liste a été rechargée, réessayez.';
      case 'NOT_EDITABLE':
      case 'INVALID_STATE':
        return error.message;
      case 'VALIDATION_ERROR':
        return 'Valeur invalide (description de 1 à 80 caractères, date valide).';
    }
  }
  return 'La modification a échoué. Vérifiez votre connexion et réessayez.';
}

/**
 * Table dense des opérations (admin, pensée pour le desktop — docs/architecture.md §6) :
 * recherche, filtres, tri, sélection multiple avec actions en masse, édition en ligne de la
 * description, de la date et de la catégorie, et panneau latéral pour le détail et la
 * modification complète (montant, payeur, répartition).
 */
export function OperationsPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const transactions = useTransactions(token);
  const participants = useParticipants(token);

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-6 lg:px-8">
      <Link to={basePath} className="text-sm font-semibold text-brand-700 lg:hidden">
        ← {me.nikount.name}
      </Link>
      <h1 className="mt-2 text-2xl font-bold lg:mt-0">Opérations</h1>
      {transactions.data && participants.data ? (
        <OperationsTable
          token={token}
          me={me}
          transactions={transactions.data}
          participants={participants.data}
        />
      ) : (
        <p className="mt-10 text-center text-slate-500" role="status">
          {transactions.isError || participants.isError
            ? 'Impossible de charger les opérations.'
            : 'Chargement…'}
        </p>
      )}
    </main>
  );
}

function OperationsTable({
  token,
  me,
  transactions,
  participants,
}: {
  token: string;
  me: MeResponse;
  transactions: TransactionView[];
  participants: ParticipantView[];
}) {
  const { currency, state } = me.nikount;
  const names = useMemo(() => new Map(participants.map((p) => [p.id, p.name])), [participants]);
  const [filters, setFilters] = useState<OperationFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const rows = useMemo(
    () => sortOperations(filterOperations(transactions, filters, names), sort, names),
    [transactions, filters, sort, names],
  );
  const selected = rows.filter((t) => selection.has(t.id));
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const editable = isActionAllowed('EDIT_OR_CANCEL', state);
  const validatedExpenses = rows
    .filter((t) => t.type === 'EXPENSE' && t.status === 'VALIDATED')
    .reduce((sum, t) => sum + t.amount, 0);
  const opened = openId ? transactions.find((t) => t.id === openId) : undefined;
  const closePanel = useCallback(() => {
    setOpenId(null);
  }, []);

  const headerCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckbox.current) {
      headerCheckbox.current.indeterminate = selected.length > 0 && !allSelected;
    }
  }, [selected.length, allSelected]);

  function setFilter<K extends keyof OperationFilters>(key: K, value: OperationFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggle(id: string) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sortHeader = (key: SortKey, label: string, className = '') => (
    <th
      scope="col"
      aria-sort={
        sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
      }
      className={`px-3 py-2 font-semibold ${className}`}
    >
      <button
        type="button"
        onClick={() => {
          setSort(nextSort(sort, key));
        }}
        className="inline-flex items-center gap-1 hover:text-slate-900"
      >
        {label}
        <span aria-hidden="true" className="text-slate-400">
          {sort.key === key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );

  return (
    <>
      <Filters
        filters={filters}
        participants={participants}
        onChange={setFilter}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
        }}
      />

      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-4 rounded-xl p-3 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}
        >
          {message.text}
        </p>
      ) : null}

      {selected.length > 0 ? (
        <BulkBar
          token={token}
          selected={selected}
          state={state}
          onDone={(text) => {
            setSelection(new Set());
            setMessage({ kind: 'ok', text });
          }}
          onError={(text) => {
            setMessage({ kind: 'error', text });
          }}
          onClear={() => {
            setSelection(new Set());
          }}
        />
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  ref={headerCheckbox}
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  checked={allSelected}
                  disabled={rows.length === 0}
                  onChange={() => {
                    setSelection(allSelected ? new Set() : new Set(rows.map((t) => t.id)));
                  }}
                  className="size-4 accent-brand-700"
                />
              </th>
              {sortHeader('date', 'Date', 'w-32')}
              {sortHeader('description', 'Description')}
              <th scope="col" className="w-40 px-3 py-2 font-semibold">
                Catégorie
              </th>
              {sortHeader('payer', 'Payeur', 'w-32')}
              <th scope="col" className="w-40 px-3 py-2 font-semibold">
                Concernés
              </th>
              {sortHeader('amount', 'Montant', 'w-32 text-right')}
              {sortHeader('status', 'Statut', 'w-28')}
              <th scope="col" className="w-20 px-3 py-2">
                <span className="sr-only">Détail</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => (
              <OperationRow
                key={t.id}
                token={token}
                transaction={t}
                names={names}
                currency={currency}
                editable={editable && isEditable(t)}
                selected={selection.has(t.id)}
                opened={openId === t.id}
                onToggle={() => {
                  toggle(t.id);
                }}
                onOpen={() => {
                  setOpenId(t.id);
                }}
                onMessage={setMessage}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-slate-500">
            {transactions.length === 0
              ? 'Aucune opération pour l’instant.'
              : 'Aucune opération ne correspond à ces filtres.'}
          </p>
        ) : null}
      </div>

      <p className="mt-3 text-sm text-slate-600" role="status">
        {rows.length} opération{rows.length > 1 ? 's' : ''}
        {rows.length !== transactions.length ? ` sur ${String(transactions.length)}` : ''} ·
        Dépenses validées :{' '}
        <strong className="tabular">{formatMoney(validatedExpenses, currency)}</strong>
      </p>

      {opened ? (
        <SidePanel
          key={opened.id}
          token={token}
          me={me}
          transaction={opened}
          onClose={closePanel}
          onSaved={() => {
            setMessage({ kind: 'ok', text: `« ${opened.description} » modifiée.` });
          }}
        />
      ) : null}
    </>
  );
}

// --- Filtres ---------------------------------------------------------------------------------

function Filters({
  filters,
  participants,
  onChange,
  onReset,
}: {
  filters: OperationFilters;
  participants: ParticipantView[];
  onChange: <K extends keyof OperationFilters>(key: K, value: OperationFilters[K]) => void;
  onReset: () => void;
}) {
  const count = activeFilterCount(filters);
  const select =
    'block min-h-10 w-full rounded-lg border-0 bg-white px-2 text-sm ring-1 ring-slate-300 ring-inset';
  const field = (label: string, control: ReactNode) => (
    <label className="block text-xs font-semibold text-slate-500">
      {label}
      <span className="mt-1 block">{control}</span>
    </label>
  );

  return (
    <div className="mt-4 space-y-3">
      <input
        type="search"
        aria-label="Rechercher"
        placeholder="Rechercher une description, une personne…"
        value={filters.q}
        onChange={(event) => {
          onChange('q', event.target.value);
        }}
        className="block min-h-11 w-full rounded-xl border-0 bg-white px-4 ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-brand-700"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {field(
          'Type',
          <select
            className={select}
            value={filters.type}
            onChange={(event) => {
              onChange('type', event.target.value as OperationFilters['type']);
            }}
          >
            <option value="ALL">Tous</option>
            <option value="EXPENSE">Dépenses</option>
            <option value="REIMBURSEMENT">Remboursements</option>
          </select>,
        )}
        {field(
          'Statut',
          <select
            className={select}
            value={filters.status}
            onChange={(event) => {
              onChange('status', event.target.value as OperationFilters['status']);
            }}
          >
            <option value="ALL">Tous</option>
            <option value="PENDING">En attente</option>
            <option value="VALIDATED">Validées</option>
            <option value="REJECTED">Refusées</option>
            <option value="CANCELLED">Annulées</option>
          </select>,
        )}
        {field(
          'Payeur',
          <select
            className={select}
            value={filters.payerId}
            onChange={(event) => {
              onChange('payerId', event.target.value);
            }}
          >
            <option value="">Tous</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>,
        )}
        {field(
          'Concerné',
          <select
            className={select}
            value={filters.participantId}
            onChange={(event) => {
              onChange('participantId', event.target.value);
            }}
          >
            <option value="">Tous</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>,
        )}
        {field(
          'Catégorie',
          <select
            className={select}
            value={filters.category}
            onChange={(event) => {
              onChange('category', event.target.value as OperationFilters['category']);
            }}
          >
            <option value="ALL">Toutes</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.emoji} {c.label}
              </option>
            ))}
            <option value="NONE">Sans catégorie</option>
          </select>,
        )}
        {field(
          'Du',
          <input
            type="date"
            className={select}
            value={filters.from}
            onChange={(event) => {
              onChange('from', event.target.value);
            }}
          />,
        )}
        {field(
          'Au',
          <input
            type="date"
            className={select}
            value={filters.to}
            onChange={(event) => {
              onChange('to', event.target.value);
            }}
          />,
        )}
        <div className="flex items-end">
          <button
            type="button"
            disabled={count === 0}
            onClick={onReset}
            className="min-h-10 w-full rounded-lg text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:text-slate-400 disabled:hover:bg-transparent"
          >
            Réinitialiser{count > 0 ? ` (${String(count)})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Actions en masse -----------------------------------------------------------------------

function BulkBar({
  token,
  selected,
  state,
  onDone,
  onError,
  onClear,
}: {
  token: string;
  selected: TransactionView[];
  state: MeResponse['nikount']['state'];
  onDone: (message: string) => void;
  onError: (message: string) => void;
  onClear: () => void;
}) {
  const bulk = useBulkStatus(token);
  const [confirming, setConfirming] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const available = bulkAvailability(selected);
  const allowed = isStatusActionAllowedInState('VALIDATE', state);
  const n = selected.length;
  const plural = n > 1 ? 's' : '';

  function run(action: StatusActionPath) {
    bulk.mutate(
      {
        action,
        ids: selected.map((t) => t.id),
        ...(action !== 'validate' && reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          const verb =
            action === 'validate' ? 'validée' : action === 'reject' ? 'refusée' : 'annulée';
          setConfirming(null);
          setReason('');
          onDone(`${String(n)} opération${plural} ${verb}${plural}.`);
        },
        onError: (error) => {
          onError(statusErrorMessage(error));
        },
      },
    );
  }

  return (
    <div
      role="region"
      aria-label="Actions sur la sélection"
      className="sticky top-0 z-10 mt-4 rounded-2xl bg-brand-50 p-3 ring-1 ring-brand-700/20"
    >
      {confirming ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-sm font-semibold text-slate-700">
            Motif (facultatif)
            <input
              value={reason}
              maxLength={200}
              autoFocus
              onChange={(event) => {
                setReason(event.target.value);
              }}
              className="mt-1 block min-h-10 w-full rounded-lg border-0 bg-white px-3 font-normal ring-1 ring-slate-300 ring-inset"
            />
          </label>
          <Button
            className="min-h-10 bg-red-700 px-4 text-sm hover:bg-red-800"
            disabled={bulk.isPending}
            onClick={() => {
              run(confirming);
            }}
          >
            {confirming === 'reject'
              ? `Confirmer le refus de ${String(n)} opération${plural}`
              : `Confirmer l’annulation de ${String(n)} opération${plural}`}
          </Button>
          <Button
            variant="ghost"
            className="min-h-10 px-3 text-sm"
            onClick={() => {
              setConfirming(null);
              setReason('');
            }}
          >
            Retour
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 text-sm font-semibold text-brand-800">
            {n} sélectionnée{plural}
          </p>
          <Button
            className="min-h-10 px-4 text-sm"
            disabled={!allowed || !available.validate || bulk.isPending}
            onClick={() => {
              run('validate');
            }}
          >
            Valider
          </Button>
          <Button
            variant="secondary"
            className="min-h-10 px-4 text-sm"
            disabled={!allowed || !available.reject || bulk.isPending}
            onClick={() => {
              setConfirming('reject');
            }}
          >
            Refuser
          </Button>
          <Button
            variant="secondary"
            className="min-h-10 px-4 text-sm"
            disabled={!allowed || !available.cancel || bulk.isPending}
            onClick={() => {
              setConfirming('cancel');
            }}
          >
            Annuler les opérations
          </Button>
          <Button variant="ghost" className="min-h-10 px-3 text-sm" onClick={onClear}>
            Désélectionner
          </Button>
          {!available.validate && !available.cancel ? (
            <p className="w-full text-xs text-slate-600">
              Valider ou refuser : seulement des opérations en attente. Annuler : seulement des
              opérations validées.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// --- Ligne et édition en ligne --------------------------------------------------------------

function OperationRow({
  token,
  transaction: t,
  names,
  currency,
  editable,
  selected,
  opened,
  onToggle,
  onOpen,
  onMessage,
}: {
  token: string;
  transaction: TransactionView;
  names: Map<string, string>;
  currency: string;
  editable: boolean;
  selected: boolean;
  opened: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMessage: (message: { kind: 'ok' | 'error'; text: string } | null) => void;
}) {
  const update = useUpdateTransaction(token);
  const closed = t.status === 'REJECTED' || t.status === 'CANCELLED';
  const status = STATUS_LABELS[t.status];

  function save(changes: Parameters<typeof updateBodyFrom>[1]) {
    onMessage(null);
    update.mutate(
      { id: t.id, body: updateBodyFrom(t, changes) },
      {
        onError: (error) => {
          onMessage({ kind: 'error', text: editErrorMessage(error) });
        },
      },
    );
  }

  const concerned =
    t.type === 'REIMBURSEMENT'
      ? `→ ${names.get(t.shares[0]?.participantId ?? '') ?? '?'}`
      : t.shares.length <= 3
        ? t.shares.map((s) => names.get(s.participantId) ?? '?').join(', ')
        : `${String(t.shares.length)} personnes`;

  return (
    <tr
      className={`${selected ? 'bg-brand-50/60' : 'hover:bg-slate-50'} ${opened ? 'outline-2 -outline-offset-2 outline-brand-700' : ''} ${closed ? 'text-slate-400' : ''} ${update.isPending ? 'opacity-60' : ''}`}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Sélectionner ${t.description}`}
          checked={selected}
          onChange={onToggle}
          className="size-4 accent-brand-700"
        />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <InlineEdit
          label={`Date de ${t.description}`}
          value={t.occurredOn}
          display={formatShortDate(t.occurredOn)}
          type="date"
          editable={editable}
          onSave={(occurredOn) => {
            save({ occurredOn });
          }}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">{transactionEmoji(t.type, t.category)}</span>
          <InlineEdit
            label={`Description de ${t.description}`}
            value={t.description}
            display={
              <span className={closed ? 'line-through' : 'font-semibold'}>{t.description}</span>
            }
            maxLength={80}
            editable={editable}
            onSave={(description) => {
              save({ description });
            }}
          />
        </div>
      </td>
      <td className="px-3 py-2">
        {t.type === 'EXPENSE' && editable ? (
          <select
            aria-label={`Catégorie de ${t.description}`}
            value={t.category ?? ''}
            disabled={update.isPending}
            onChange={(event) => {
              save({ category: (event.target.value || null) as TransactionCategory | null });
            }}
            className="block min-h-9 w-full rounded-lg border-0 bg-transparent px-1 text-sm ring-1 ring-transparent ring-inset hover:ring-slate-300 focus:ring-brand-700"
          >
            <option value="">—</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1">
            {CATEGORIES.find((c) => c.value === t.category)?.label ??
              (t.type === 'REIMBURSEMENT' ? 'Remboursement' : '—')}
          </span>
        )}
      </td>
      <td className="truncate px-3 py-2">{names.get(t.payerId) ?? '?'}</td>
      <td className="max-w-40 truncate px-3 py-2" title={concerned}>
        {concerned}
      </td>
      <td className={`tabular px-3 py-2 text-right font-semibold ${closed ? 'line-through' : ''}`}>
        {formatMoney(t.amount, currency)}
      </td>
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>
          {status.label}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Ouvrir le détail de ${t.description}`}
          className="rounded-lg px-2 py-1 font-semibold whitespace-nowrap text-brand-700 hover:bg-brand-50"
        >
          Détail ›
        </button>
      </td>
    </tr>
  );
}

/**
 * Cellule modifiable : un clic l'ouvre, Entrée ou la sortie du champ enregistre, Échap annule.
 * Rien n'est envoyé si la valeur n'a pas changé ou est vide.
 */
function InlineEdit({
  label,
  value,
  display,
  type = 'text',
  maxLength,
  editable,
  onSave,
}: {
  label: string;
  value: string;
  display: ReactNode;
  type?: 'text' | 'date';
  maxLength?: number;
  editable: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Échap ferme le champ sans enregistrer, même si le navigateur signale ensuite une sortie.
  const cancelled = useRef(false);
  if (!editable) return <span>{display}</span>;

  if (draft === null) {
    return (
      // Le nom accessible commence par le texte visible (WCAG 2.5.3) : « 28 sept. (modifier :
      // Date de Essence) » se déclenche aussi à la voix en disant ce qui est affiché.
      <button
        type="button"
        title="Cliquer pour modifier"
        onClick={() => {
          cancelled.current = false;
          setDraft(value);
        }}
        className="-mx-1 rounded px-1 text-left hover:bg-slate-100 hover:ring-1 hover:ring-slate-300"
      >
        {display}
        <span className="sr-only"> (modifier : {label})</span>
      </button>
    );
  }

  const commit = () => {
    if (cancelled.current) return;
    const next = draft.trim();
    setDraft(null);
    if (next && next !== value) onSave(next);
  };

  return (
    <input
      aria-label={label}
      type={type}
      value={draft}
      maxLength={maxLength}
      autoFocus
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          cancelled.current = true;
          setDraft(null);
        }
      }}
      className="block min-h-9 w-full rounded-lg border-0 bg-white px-2 text-sm ring-2 ring-brand-700"
    />
  );
}

// --- Panneau latéral -------------------------------------------------------------------------

function SidePanel({
  token,
  me,
  transaction,
  onClose,
  onSaved,
}: {
  token: string;
  me: MeResponse;
  transaction: TransactionView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={
        editing ? `Modifier ${transaction.description}` : `Détail de ${transaction.description}`
      }
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col overflow-y-auto bg-slate-50 px-5 py-5 shadow-2xl ring-1 ring-slate-200"
    >
      <div className="flex items-center justify-between">
        {editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
            }}
            className="text-sm font-semibold text-brand-700"
          >
            ← Détail
          </button>
        ) : (
          <span className="text-sm font-semibold text-slate-500">Détail</span>
        )}
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200"
        >
          Fermer ✕
        </button>
      </div>
      {editing ? (
        <>
          <h2 className="mt-4 text-xl font-bold">
            {transaction.type === 'REIMBURSEMENT'
              ? 'Modifier le remboursement'
              : 'Modifier la dépense'}
          </h2>
          <TransactionEditor
            token={token}
            me={me}
            transaction={transaction}
            onSaved={() => {
              setEditing(false);
              onSaved();
            }}
          />
        </>
      ) : (
        <TransactionDetail
          token={token}
          me={me}
          transactionId={transaction.id}
          onEdit={() => {
            setEditing(true);
          }}
        />
      )}
    </aside>
  );
}
