import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CreateNikountRequest, type CreateNikountResponse } from '@nikount/contracts';
import { ApiError } from '../../api/client';
import { useCreateNikount } from '../../api/nikount';
import { Button, Card, PageShell, ShareableLink, TextField } from '../../components/ui';
import { nikountPath, nikountUrl } from '../../lib/links';
import { rememberNikount } from '../../lib/recent-nikounts';

type FieldErrors = Partial<Record<'name' | 'adminLabel', string>>;

function validate(name: string, adminLabel: string): FieldErrors {
  const result = CreateNikountRequest.safeParse({ name, adminLabel });
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === 'name') errors.name = 'Donnez un nom (60 caractères maximum).';
    if (field === 'adminLabel')
      errors.adminLabel = 'Indiquez votre prénom (40 caractères maximum).';
  }
  return errors;
}

export function NewNikountPage() {
  const [created, setCreated] = useState<CreateNikountResponse | null>(null);
  return created ? <CreatedLinks created={created} /> : <CreateForm onCreated={setCreated} />;
}

function CreateForm({ onCreated }: { onCreated: (created: CreateNikountResponse) => void }) {
  const [name, setName] = useState('');
  const [adminLabel, setAdminLabel] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const create = useCreateNikount();

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const fieldErrors = validate(name, adminLabel);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    create.mutate(
      { name, adminLabel },
      {
        onSuccess: (response) => {
          rememberNikount({
            token: response.adminToken,
            role: 'ADMIN',
            name: response.nikount.name,
          });
          onCreated(response);
        },
      },
    );
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
