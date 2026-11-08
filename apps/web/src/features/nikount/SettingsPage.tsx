import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  NikountName,
  PersonLabel,
  StateChangeReason,
  type AdminListItem,
  type MeResponse,
  type NikountState,
  type ParticipantView,
} from '@nikount/contracts';
import { transitionsFrom, type NikountTransition } from '@nikount/core';
import { useBalances } from '../../api/balances';
import { ApiError } from '../../api/client';
import {
  useAdmins,
  useChangeNikountState,
  useCreateAdmin,
  useRenameNikount,
  useRevokeAdmin,
  useRotateParticipantLink,
} from '../../api/nikount';
import { useParticipants } from '../../api/participants';
import { Button, Card, PageShell, ShareableLink, StateBadge, TextField } from '../../components/ui';
import { formatMoney } from '../../lib/format';
import { nikountUrl } from '../../lib/links';
import { forgetNikount } from '../../lib/recent-nikounts';

const STATE_DESCRIPTIONS: Record<NikountState, string> = {
  OPEN: 'Les participants peuvent ajouter des dépenses et des remboursements.',
  SETTLEMENT:
    'Événement terminé : les dépenses sont fermées, on solde les comptes par des remboursements.',
  CLOSED: 'Comptes clôturés : le nikount reste consultable, mais plus rien ne peut changer.',
};

const TRANSITION_TEXTS: Record<
  NikountTransition,
  { action: string; help: string; done: string; primary: boolean }
> = {
  FINISH: {
    action: 'Terminer l’événement',
    help: 'Ferme les nouvelles dépenses ; les remboursements restent possibles. Vous pourrez revenir en arrière.',
    done: 'Événement terminé : place aux remboursements.',
    primary: true,
  },
  UNLOCK: {
    action: 'Rouvrir aux dépenses',
    help: 'Pour ajouter une dépense oubliée. Les participants pourront de nouveau en saisir.',
    done: 'Le nikount accepte de nouveau les dépenses.',
    primary: false,
  },
  CLOSE: {
    action: 'Clôturer les comptes',
    help: 'Fige définitivement les comptes. Une réouverture reste possible, à titre exceptionnel et avec un motif.',
    done: 'Comptes clôturés.',
    primary: true,
  },
  REOPEN: {
    action: 'Réouvrir (exceptionnel)',
    help: 'Repasse le nikount en règlement pour corriger une erreur. Le motif est conservé dans le journal.',
    done: 'Nikount réouvert en règlement.',
    primary: false,
  },
};

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'VERSION_CONFLICT':
        return 'Le nikount a été modifié entre-temps : la page a été rechargée, réessayez.';
      case 'PENDING_REMAINING':
      case 'INVALID_STATE_TRANSITION':
      case 'INVALID_STATE':
      case 'REASON_REQUIRED':
      case 'LAST_ADMIN':
      case 'ADMIN_LIMIT_REACHED':
        return error.message;
      case 'NOT_FOUND':
        return 'Élément introuvable : la page a été rechargée.';
      case 'VALIDATION_ERROR':
        return 'Valeur invalide.';
    }
  }
  return 'L’opération a échoué. Vérifiez votre connexion et réessayez.';
}

/** Gestion du nikount (admin) : état, nom, lien du groupe, administrateurs. */
export function SettingsPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const participants = useParticipants(token);
  return (
    <PageShell>
      <Link to={`${basePath}/menu`} className="self-start text-sm font-semibold text-brand-700">
        ← {me.nikount.name}
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Gestion du nikount</h1>

      <StateCard token={token} me={me} basePath={basePath} />
      <NameCard token={token} me={me} />
      <GroupLinkCard token={token} me={me} />
      <AdminsCard token={token} me={me} participants={participants.data ?? []} />
    </PageShell>
  );
}

function StateCard({ token, me, basePath }: { token: string; me: MeResponse; basePath: string }) {
  const { state, version, currency } = me.nikount;
  const balances = useBalances(token);
  const change = useChangeNikountState(token);
  const [pending, setPending] = useState<NikountTransition | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);

  const pendingCount = balances.data?.pending.count ?? 0;
  const outstanding = (balances.data?.balances ?? [])
    .filter((b) => b.balance > 0)
    .reduce((sum, b) => sum + b.balance, 0);
  const rules = transitionsFrom(state);
  const selected = rules.find((r) => r.transition === pending) ?? null;

  const reset = () => {
    setPending(null);
    setReason('');
    setReasonError(undefined);
    change.reset();
  };

  const confirm = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    let cleanReason: string | undefined;
    if (selected.reasonRequired) {
      const parsed = StateChangeReason.safeParse(reason);
      if (!parsed.success) {
        setReasonError('Motif obligatoire (200 caractères au plus).');
        return;
      }
      cleanReason = parsed.data;
    }
    change.mutate(
      { to: selected.to, version, ...(cleanReason ? { reason: cleanReason } : {}) },
      {
        onSuccess: () => {
          setDone(TRANSITION_TEXTS[selected.transition].done);
          setPending(null);
          setReason('');
        },
      },
    );
  };

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">État</h2>
        <StateBadge state={state} />
      </div>
      <p className="mt-1 text-sm text-slate-600">{STATE_DESCRIPTIONS[state]}</p>

      {done ? (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          {done}
        </p>
      ) : null}

      {selected ? (
        <form onSubmit={confirm} className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
          <p className="font-semibold">{TRANSITION_TEXTS[selected.transition].action} ?</p>
          <p className="text-sm text-slate-600">{TRANSITION_TEXTS[selected.transition].help}</p>
          {selected.transition === 'CLOSE' && outstanding > 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              ⚠️ Les comptes ne sont pas soldés : il reste {formatMoney(outstanding, currency)} à
              rembourser. Vous pouvez clôturer quand même (par exemple si c’est réglé hors de
              l’application).
            </p>
          ) : null}
          {selected.reasonRequired ? (
            <TextField
              label="Motif de la réouverture"
              value={reason}
              maxLength={200}
              error={reasonError}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(undefined);
              }}
            />
          ) : null}
          {change.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {describeError(change.error)}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={change.isPending}>
              Confirmer
            </Button>
            <Button variant="secondary" className="flex-1" onClick={reset}>
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {rules.map((rule) => {
            const text = TRANSITION_TEXTS[rule.transition];
            const blocked = rule.requiresNoPending && pendingCount > 0;
            return (
              <div key={rule.transition} className="space-y-2">
                <Button
                  variant={text.primary ? 'primary' : 'secondary'}
                  className="w-full"
                  disabled={blocked || !balances.data}
                  onClick={() => {
                    setDone(null);
                    change.reset();
                    setPending(rule.transition);
                  }}
                >
                  {text.action}
                </Button>
                {blocked ? (
                  <p className="text-sm text-amber-900">
                    {pendingCount} opération{pendingCount > 1 ? 's' : ''} en attente : validez-les
                    ou refusez-les avant de clôturer.{' '}
                    <Link to={`${basePath}/review`} className="font-semibold underline">
                      Les examiner
                    </Link>
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function NameCard({ token, me }: { token: string; me: MeResponse }) {
  const rename = useRenameNikount(token);
  const [name, setName] = useState(me.nikount.name);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = NikountName.safeParse(name);
    if (!parsed.success) {
      setError('Nom entre 1 et 60 caractères.');
      return;
    }
    rename.mutate(
      { name: parsed.data, version: me.nikount.version },
      {
        onSuccess: (view) => {
          setName(view.name);
          setSaved(true);
        },
      },
    );
  };

  return (
    <Card className="mt-4">
      <h2 className="font-bold">Nom</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <TextField
          label="Nom du nikount"
          value={name}
          maxLength={60}
          error={error ?? (rename.isError ? describeError(rename.error) : undefined)}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
            setSaved(false);
            rename.reset();
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          className="w-full"
          disabled={rename.isPending || name.trim() === me.nikount.name}
        >
          {saved ? 'Enregistré ✓' : 'Renommer'}
        </Button>
      </form>
    </Card>
  );
}

function GroupLinkCard({ token, me }: { token: string; me: MeResponse }) {
  const rotate = useRotateParticipantLink(token);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className="mt-4">
      <h2 className="font-bold">Lien du groupe</h2>
      <p className="mt-1 text-sm text-slate-600">
        Si le lien a circulé au-delà du groupe, remplacez-le : l’ancien cessera aussitôt de
        fonctionner.
      </p>
      {rotate.isSuccess ? (
        <div className="mt-3 space-y-3">
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            Nouveau lien créé : envoyez-le à tout le groupe.
          </p>
          <ShareableLink
            label="Nouveau lien du groupe"
            url={nikountUrl('PARTICIPANT', rotate.data.participantToken)}
            shareTitle={me.nikount.name}
          />
        </div>
      ) : confirming ? (
        <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            L’ancien lien ne fonctionnera plus pour personne : il faudra renvoyer le nouveau à
            chaque participant. Les liens administrateur ne changent pas.
          </p>
          {rotate.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {describeError(rotate.error)}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={rotate.isPending}
              onClick={() => {
                rotate.mutate();
              }}
            >
              Remplacer le lien
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setConfirming(false);
                rotate.reset();
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Changer le lien du groupe
        </Button>
      )}
    </Card>
  );
}

function AdminsCard({
  token,
  me,
  participants,
}: {
  token: string;
  me: MeResponse;
  participants: ParticipantView[];
}) {
  const admins = useAdmins(token);
  const revoke = useRevokeAdmin(token);
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const activeCount = (admins.data ?? []).filter((a) => a.revokedAt === null).length;

  const doRevoke = (admin: AdminListItem) => {
    revoke.mutate(admin.id, {
      onSuccess: () => {
        setConfirmId(null);
        if (admin.isYou) {
          // Ce lien ne fonctionne plus : on l'oublie et on quitte le nikount.
          forgetNikount(token);
          void navigate('/', { replace: true });
        }
      },
    });
  };

  return (
    <Card className="mt-4">
      <h2 className="font-bold">Administrateurs</h2>
      <p className="mt-1 text-sm text-slate-600">
        Chaque administrateur a son propre lien. Révoquer un lien le désactive sans toucher aux
        autres.
      </p>

      {admins.isError ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          Impossible de charger les administrateurs.
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-slate-100">
        {(admins.data ?? []).map((admin) => {
          const revoked = admin.revokedAt !== null;
          const represents = admin.participantId ? names.get(admin.participantId) : undefined;
          return (
            <li key={admin.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={`truncate font-semibold ${revoked ? 'text-slate-400' : ''}`}>
                    {admin.label}
                    {admin.isYou ? ' (vous)' : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {revoked
                      ? 'Lien révoqué'
                      : represents
                        ? `Participant : ${represents}`
                        : 'Ne participe pas'}
                  </p>
                </div>
                {!revoked && activeCount > 1 && confirmId !== admin.id ? (
                  <Button
                    variant="ghost"
                    className="min-h-10 shrink-0 px-3 text-sm"
                    aria-label={`Révoquer ${admin.label}`}
                    onClick={() => {
                      revoke.reset();
                      setConfirmId(admin.id);
                    }}
                  >
                    Révoquer
                  </Button>
                ) : null}
              </div>
              {confirmId === admin.id ? (
                <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3">
                  <p className="text-sm text-slate-700">
                    {admin.isYou
                      ? 'Votre propre lien ne fonctionnera plus : vous perdrez l’accès administrateur.'
                      : `Le lien de ${admin.label} ne fonctionnera plus.`}
                  </p>
                  {revoke.isError ? (
                    <p role="alert" className="text-sm text-red-600">
                      {describeError(revoke.error)}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={revoke.isPending}
                      onClick={() => {
                        doRevoke(admin);
                      }}
                    >
                      Confirmer
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => {
                        setConfirmId(null);
                      }}
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {activeCount === 1 ? (
        <p className="text-xs text-slate-500">
          Le dernier administrateur ne peut pas être révoqué.
        </p>
      ) : null}

      <AddAdminForm token={token} me={me} participants={participants} />
    </Card>
  );
}

function AddAdminForm({
  token,
  me,
  participants,
}: {
  token: string;
  me: MeResponse;
  participants: ParticipantView[];
}) {
  const create = useCreateAdmin(token);
  const [label, setLabel] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [error, setError] = useState<string | undefined>();
  const active = participants.filter((p) => p.isActive);

  if (create.isSuccess) {
    return (
      <div className="mt-4 space-y-3 rounded-xl bg-amber-50 p-4">
        <p className="font-semibold text-amber-900">
          Lien administrateur de {create.data.admin.label}
        </p>
        <p className="text-sm text-amber-900">
          Il ne sera <strong>plus jamais affiché</strong> : copiez-le et envoyez-le uniquement à
          cette personne.
        </p>
        <ShareableLink
          label={`Lien administrateur de ${create.data.admin.label}`}
          url={nikountUrl('ADMIN', create.data.adminToken)}
          shareTitle={me.nikount.name}
        />
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            create.reset();
            setLabel('');
            setParticipantId('');
          }}
        >
          C’est fait
        </Button>
      </div>
    );
  }

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = PersonLabel.safeParse(label);
    if (!parsed.success) {
      setError('Nom entre 1 et 40 caractères.');
      return;
    }
    create.mutate({ label: parsed.data, participantId: participantId || null });
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-bold">Ajouter un administrateur</h3>
      <TextField
        label="Nom de l’administrateur"
        value={label}
        maxLength={40}
        error={error}
        onChange={(event) => {
          setLabel(event.target.value);
          setError(undefined);
          const match = active.find(
            (p) => p.name.toLowerCase() === event.target.value.trim().toLowerCase(),
          );
          if (match) setParticipantId(match.id);
        }}
      />
      <div className="space-y-1.5">
        <label htmlFor="admin-participant" className="block text-sm font-semibold text-slate-700">
          Participe aux dépenses en tant que
        </label>
        <select
          id="admin-participant"
          value={participantId}
          onChange={(event) => {
            setParticipantId(event.target.value);
          }}
          className="block min-h-12 w-full rounded-xl border-0 bg-white px-4 text-base ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-700"
        >
          <option value="">Ne participe pas (ex. trésorier)</option>
          {active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {create.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {describeError(create.error)}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" className="w-full" disabled={create.isPending}>
        Créer un lien administrateur
      </Button>
    </form>
  );
}
