import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-2xl font-bold">Page introuvable</h1>
      <p className="text-slate-600">
        Ce lien n’existe pas ou n’est plus valide. Demandez un nouveau lien à l’organisateur.
      </p>
      <Link to="/" className="font-semibold text-brand-700 underline underline-offset-4">
        Retour à l’accueil
      </Link>
    </main>
  );
}
