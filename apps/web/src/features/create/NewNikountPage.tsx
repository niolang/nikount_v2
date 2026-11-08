import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CreateNikountRequest,
  normalizeText,
  ParticipantName,
  participantNameKey,
  type CreateNikountResponse,
} from '@nikount/contracts';
import { ApiError } from '../../api/client';
import { useCreateNikount } from '../../api/nikount';
import { Button, Card, PageShell, ShareableLink, TextField } from '../../components/ui';
import { nikountPath, nikountUrl } from '../../lib/links';
import { rememberNikount } from '../../lib/recent-nikounts';

type FieldErrors = Partial<Record<'name' | 'adminLabel' | 'participants', string>>;

interface FormValues {
  name: string;
  adminLabel: string;
  adminIsParticipant: boolean;
  participants: string[];
}

function validate(values: FormValues): FieldErrors {
  const result = CreateNikountRequest.safeParse(values);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === 'name') errors.name = 'Donnez un nom (60 caractères maximum).';
    if (field === 'adminLabel')
      errors.adminLabel = 'Indiquez votre prénom (40 caractères maximum).';
    if (field === 'participants') errors.participants = issue.message;
  }
  return errors;
}

/** Saisie de la liste des participants : un nom à la fois, retirables. */
function ParticipantsInput({
  participants,
  onChange,
  reservedName,
  error,
}: {
  participants: string[];
  onChange: (participants: string[]) => void;
  /** Nom déjà pris par le créateur s'il participe. */
  reservedName: string | null;
  error: string | undefined;
}) {
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  function add() {
    const parsed = ParticipantName.safeParse(draft);
    if (!parsed.success) {
      setDraftError('Prénom entre 1 et 40 caractères.');
      return;
    }
    const key = participantNameKey(parsed.data);
    const taken = [...participants, ...(reservedName ? [normalizeText(reservedName)] : [])].some(
      (existing) => participantNameKey(existing) === key,
    );
    if (taken) {
      setDraftError(`« ${parsed.data} » est déjà dans la liste.`);
      return;
    }
    onChange([...participants, parsed.data]);
    setDraft('');
    setDraftError(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label="Participants"
            placeholder="Alice"
            value={draft}
            maxLength={40}
            autoComplete="off"
            enterKeyHint="enter"
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError(null);
            }}
            onKeyDown={(event) => {
              // Entrée ajoute le nom au lieu de soumettre le formulaire.
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            {...(draftError ? { error: draftError } : {})}
          />
        </div>
        <Button
          variant="secondary"
          onClick={add}
          className={draftError ? 'mb-7' : ''}
          aria-label="Ajouter ce participant"
        >
          Ajouter
        </Button>
      </div>

      {participants.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Participants ajoutés">
          {participants.map((participant) => (
            <li
              key={participant}
              className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pr-1 pl-3 text-sm font-semibold text-brand-800 ring-1 ring-brand-700/20"
            >
              {participant}
              <button
                type="button"
                aria-label={`Retirer ${participant}`}
                className="flex size-7 items-center justify-center rounded-full hover:bg-brand-100"
                onClick={() => {
                  onChange(participants.filter((p) => p !== participant));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Facultatif : vous pourrez en ajouter plus tard.</p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

export function NewNikountPage() {
  const [created, setCreated] = useState<CreateNikountResponse | null>(null);
  return created ? <CreatedLinks created={created} /> : <CreateForm onCreated={setCreated} />;
}

function CreateForm({ onCreated }: { onCreated: (created: CreateNikountResponse) => void }) {
  const [name, setName] = useState('');
  const [adminLabel, setAdminLabel] = useState('');
  const [adminIsParticipant, setAdminIsParticipant] = useState(true);
  const [participants, setParticipants] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const create = useCreateNikount();

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = { name, adminLabel, adminIsParticipant, participants };
    const fieldErrors = validate(values);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    create.mutate(values, {
      onSuccess: (response) => {
        rememberNikount({
          token: response.adminToken,
          role: 'ADMIN',
          name: response.nikount.name,
        });
        onCreated(response);
      },
    });
  }

  const apiError =
    create.error instanceof ApiError && create.error.code === 'RATE_LIMITED'
      ? 'Trop de créations depuis cette connexion. Réessayez dans une heure.'
      : create.error
        ? 'La création a échoué. Vérifiez votre connexion et réessayez.'
        : null;

  return (
    <PageShell>
      <Link to="/" className="self-start text-sm font-semibold text-brand-700">
        ← Retour
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Nouveau nikount</h1>
      <p className="mt-2 text-slate-600">Un nikount par événement : week-end, vacances, sortie…</p>

      <form onSubmit={submit} noValidate className="mt-8 flex flex-1 flex-col gap-6">
        <TextField
          label="Nom de l’événement"
          placeholder="Weekend Chamonix"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          maxLength={60}
          autoComplete="off"
          enterKeyHint="next"
          {...(errors.name ? { error: errors.name } : {})}
        />
        <TextField
          label="Votre prénom"
          hint="Vous serez l’administrateur : vous validerez les dépenses."
          placeholder="Nicolas"
          value={adminLabel}
          onChange={(event) => {
            setAdminLabel(event.target.value);
          }}
          maxLength={40}
          autoComplete="given-name"
          enterKeyHint="done"
          {...(errors.adminLabel ? { error: errors.adminLabel } : {})}
        />
        <label className="-mt-3 flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={adminIsParticipant}
            onChange={(event) => {
              setAdminIsParticipant(event.target.checked);
            }}
            className="size-5 accent-brand-700"
          />
          Je participe aussi aux dépenses
        </label>

        <ParticipantsInput
          participants={participants}
          onChange={setParticipants}
          reservedName={adminIsParticipant ? adminLabel : null}
          error={errors.participants}
        />

        {apiError ? (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {apiError}
          </p>
        ) : null}

        <div className="mt-auto">
          <Button type="submit" className="w-full" disabled={create.isPending}>
            {create.isPending ? 'Création…' : 'Créer le nikount'}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}

function CreatedLinks({ created }: { created: CreateNikountResponse }) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const { name } = created.nikount;

  return (
    <PageShell>
      <h1 className="text-2xl font-bold">« {name} » est prêt 🎉</h1>
      <p className="mt-2 text-slate-600">Voici vos deux liens. Ils remplacent les comptes.</p>

      <div className="mt-6 space-y-4">
        <Card>
          <h2 className="font-bold">👥 Lien du groupe</h2>
          <p className="mt-1 mb-3 text-sm text-slate-600">
            À envoyer aux participants : ils pourront consulter et ajouter des dépenses.
          </p>
          <ShareableLink
            label="Lien du groupe"
            url={nikountUrl('PARTICIPANT', created.participantToken)}
            shareTitle={name}
          />
        </Card>

        <Card className="ring-2 ring-amber-400">
          <h2 className="font-bold">🔑 Votre lien administrateur</h2>
          <p className="mt-1 mb-3 text-sm text-slate-700">
            <strong>Pour vous seul.</strong> Il donne tous les droits. Il ne sera plus jamais
            affiché : enregistrez-le (favori, note, message à vous-même).
          </p>
          <ShareableLink
            label="Votre lien administrateur"
            url={nikountUrl('ADMIN', created.adminToken)}
            shareTitle={`${name} (admin)`}
          />
        </Card>
      </div>

      <label className="mt-6 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => {
            setSaved(event.target.checked);
          }}
          className="mt-0.5 size-5 accent-brand-700"
        />
        J’ai enregistré mon lien administrateur en lieu sûr.
      </label>

      <Button
        className="mt-4 w-full"
        disabled={!saved}
        onClick={() => {
          void navigate(nikountPath('ADMIN', created.adminToken));
        }}
      >
        Ouvrir mon nikount
      </Button>
    </PageShell>
  );
}
