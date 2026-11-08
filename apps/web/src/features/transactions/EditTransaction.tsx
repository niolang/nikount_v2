import { Link, useNavigate, useParams } from 'react-router';
import type { MeResponse, TransactionView } from '@nikount/contracts';
import { isActionAllowed } from '@nikount/core';
import { ApiError } from '../../api/client';
import { useParticipants } from '../../api/participants';
import { useTransaction } from '../../api/transactions';
import { PageShell } from '../../components/ui';
import { isEditable } from '../../lib/operations';
import { ExpenseForm } from './ExpenseFormPage';
import { ReimbursementForm } from './ReimbursementFormPage';

/**
 * Formulaire de modification d'une opération (admin), selon son type. Utilisé par la page
 * `tx/:id/edit` (mobile) et par le panneau latéral de la table des opérations (desktop).
 */
export function TransactionEditor({
  token,
  me,
  transaction,
  onSaved,
}: {
  token: string;
  me: MeResponse;
  transaction: TransactionView;
  onSaved: (transaction: TransactionView) => void;
}) {
  const participants = useParticipants(token);

  if (!isEditable(transaction) || !isActionAllowed('EDIT_OR_CANCEL', me.nikount.state)) {
    return (
      <p className="mt-6 rounded-xl bg-slate-100 p-4 text-slate-700">
        {isEditable(transaction)
          ? 'Ce nikount est clôturé : plus aucune modification.'
          : 'Une opération refusée ou annulée ne se modifie plus.'}
      </p>
    );
  }
  if (!participants.data) {
    return (
      <p className="mt-6 text-slate-500" role="status">
        {participants.isError ? 'Impossible de charger les participants.' : 'Chargement…'}
      </p>
    );
  }
  const props = {
    token,
    me,
    participants: participants.data,
    existing: transaction,
    onSaved,
  };
  // La clé remet le formulaire à zéro si l'opération change (autre version, autre opération).
  const key = `${transaction.id}:${String(transaction.version)}`;
  return transaction.type === 'EXPENSE' ? (
    <ExpenseForm key={key} {...props} />
  ) : (
    <ReimbursementForm key={key} {...props} />
  );
}

/** Page de modification (admin) : `/a/:token/tx/:id/edit`. */
export function EditTransactionPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const { transactionId = '' } = useParams();
  const navigate = useNavigate();
  const transaction = useTransaction(token, transactionId);
  const detailPath = `${basePath}/tx/${transactionId}`;

  return (
    <PageShell>
      <Link to={detailPath} className="self-start text-sm font-semibold text-brand-700">
        ← Retour au détail
      </Link>
      <h1 className="mt-4 text-2xl font-bold">
        {transaction.data?.type === 'REIMBURSEMENT'
          ? 'Modifier le remboursement'
          : 'Modifier la dépense'}
      </h1>
      {transaction.data ? (
        <TransactionEditor
          token={token}
          me={me}
          transaction={transaction.data}
          onSaved={() => {
            void navigate(detailPath);
          }}
        />
      ) : transaction.error ? (
        <p className="mt-10 text-center text-slate-600">
          {transaction.error instanceof ApiError && transaction.error.status === 404
            ? 'Cette opération n’existe pas dans ce nikount.'
            : 'Impossible de charger cette opération.'}
        </p>
      ) : (
        <p className="mt-10 text-center text-slate-500" role="status">
          Chargement…
        </p>
      )}
    </PageShell>
  );
}
