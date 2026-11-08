import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { ParticipantName, type MeResponse, type ParticipantView } from '@nikount/contracts';
import { isActionAllowed } from '@nikount/core';
import { ApiError } from '../../api/client';
import {
  useCreateParticipant,
  useParticipants,
  useUpdateParticipant,
} from '../../api/participants';
import { Button, Card, PageShell, TextField } from '../../components/ui';

/** Message lisible pour une erreur de l'API sur les participants. */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'PARTICIPANT_NAME_TAKEN':
        return error.message;
      case 'VERSION_CONFLICT':
        return 'Ce participant a été modifié par quelqu’un d’autre : la liste a été rechargée, réessayez.';
      case 'PARTICIPANT_LIMIT_REACHED':
      case 'INVALID_STATE':
        return error.message;
      case 'VALIDATION_ERROR':
        return 'Prénom entre 1 et 40 caractères.';
    }
  }
  return 'L’opération a échoué. Vérifiez votre connexion et réessayez.';
}

/** Gestion des participants (admin) : ajout, renommage, désactivation / réactivation. */
export function ManageParticipantsPage({ token, me }: { token: string; me: MeResponse }) {
  const participants = useParticipants(token);
  const editable = isActionAllowed('MANAGE_PARTICIPANTS', me.nikount.state);

  return (
    <PageShell>
      <Link to=".." className="self-start text-sm font-semibold text-brand-700">
        ← {me.nikount.name}
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Participants</h1>
      <p className="mt-1 text-sm text-slate-600">
        Un participant ne peut pas être supprimé (il peut figurer dans des dépenses) :
        désactivez-le.
      </p>

      {editable ? (
        <AddParticipantForm token={token} />
      ) : (
        <p className="mt-6 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
          Ce nikount est clôturé : la liste des participants est figée.
        </p>
      )}

      {participants.isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600">
          Impossible de charger les participants.
        </p>
      ) : null}

      {participants.data ? (
        <ul className="mt-6 space-y-2">
          {participants.data.map((participant) => (
            <ParticipantRow
              key={participant.id}
              token={token}
              participant={participant}
              isMe={participant.id === me.admin?.participantId}
              editable={editable}
            />
          ))}
        </ul>
      ) : null}
    </PageShell>
  );
}

function AddParticipantForm({ token }: { token: string }) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const create = useCreateParticipant(token);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ParticipantName.safeParse(name);
    if (!parsed.success) {
      setLocalError('Prénom entre 1 et 40 caractères.');
      return;
    }
    setLocalError(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        setName('');
      },
    });
  }

  const error = localError ?? (create.error ? describeError(create.error) : null);

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex items-end gap-2">
      <div className="flex-1">
        <TextField
          label="Ajouter un participant"
          placeholder="Prénom"
          value={name}
          maxLength={40}
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
            setLocalError(null);
            create.reset();
          }}
          {...(error ? { error } : {})}
        />
      </div>
      <Button type="submit" disabled={create.isPending} className={error ? 'mb-7' : ''}>
        Ajouter
      </Button>
    </form>
  );
}

function ParticipantRow({
  token,
  participant,
  isMe,
  editable,
}: {
  token: string;
  participant: ParticipantView;
  isMe: boolean;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(participant.name);
  const update = useUpdateParticipant(token);
  const error = update.error ? describeError(update.error) : null;

  function rename(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ParticipantName.safeParse(draft);
    if (!parsed.success || parsed.data === participant.name) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id: participant.id, name: parsed.data, version: participant.version },
      {
        onSuccess: () => {
          setEditing(false);
        },
      },
    );
  }

  return (
    <li>
      <Card className={`p-3 ${participant.isActive ? '' : 'bg-slate-50 opacity-70'}`}>
        {editing ? (
          <form onSubmit={rename} noValidate className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={`Nouveau nom pour ${participant.name}`}
                value={draft}
                maxLength={40}
                autoFocus
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
            </div>
            <Button type="submit" disabled={update.isPending}>
              OK
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(participant.name);
                update.reset();
              }}
            >
              Annuler
            </Button>
          </form>
        ) : (
          <div className="space-y-1">
            {/* Nom sur sa propre ligne : jamais tronqué par les boutons sur petit écran. */}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold break-words">
              <span className="min-w-0 break-all">{participant.name}</span>
              {isMe ? <span className="font-normal text-slate-500">(vous)</span> : null}
              {participant.isActive ? null : (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  désactivé
                </span>
              )}
            </p>
            {editable ? (
              <div className="-ml-3 flex flex-wrap">
                <Button
                  variant="ghost"
                  className="min-h-10 px-3 text-sm"
                  onClick={() => {
                    update.reset();
                    setDraft(participant.name);
                    setEditing(true);
                  }}
                  aria-label={`Renommer ${participant.name}`}
                >
                  Renommer
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-10 px-3 text-sm"
                  disabled={update.isPending}
                  onClick={() => {
                    update.mutate({
                      id: participant.id,
                      isActive: !participant.isActive,
                      version: participant.version,
                    });
                  }}
                  aria-label={`${participant.isActive ? 'Désactiver' : 'Réactiver'} ${participant.name}`}
                >
                  {participant.isActive ? 'Désactiver' : 'Réactiver'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </Card>
    </li>
  );
}
