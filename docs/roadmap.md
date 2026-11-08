# nikount — Roadmap

> Chaque phase est livrable et testable seule. « Fini » = critères remplis + tests verts + doc à jour.

| Phase                              | Contenu                                                                                                                                                                                                                                                          | Critères de fin                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **0** Architecture ✅              | `docs/*`, décisions validées ([decisions.md](decisions.md))                                                                                                                                                                                                      | Terminée le 2026-11-08                                                                                                   |
| **1** Socle 🟡                     | Monorepo pnpm, `apps/api` (Fastify, config Zod, logs, `/health`), `apps/web` (Vite, Tailwind, router, manifest PWA), `packages/core` + `contracts` vides, Drizzle + 1re migration, Docker Compose dev, ESLint/Prettier, TS strict, CI (lint + typecheck + tests) | `docker compose up` → front et `/api/v1/health` OK ; CI verte                                                            |
| **2** Nikount + accès ✅           | `POST /nikounts`, tokens (génération, hash), plugin `auth`, `GET /me`, `/nikount` ; écrans `/`, `/new`, « Vos liens », accueil vide ; « Mes nikounts » local                                                                                                     | Tests : token inconnu → 401 ; participant ≠ admin ; création rate-limitée                                                |
| **3** Participants ✅              | CRUD admin, désactivation, choix d'identité déclarée côté participant                                                                                                                                                                                            | Tests : nom unique, isolation inter-nikount                                                                              |
| **4** Opérations + répartitions ✅ | `core/split.ts` **écrit en premier, test-first** ; tables `transaction`, `transaction_share`, `transaction_revision`, triggers ; `POST/GET /transactions` ; formulaire mobile avec prévisualisation                                                              | Tests de propriétés : Σ parts = montant pour tous modes ; trigger refuse une incohérence ; idempotence `clientRequestId` |
| **5** Moteur comptable + soldes ✅ | `core/balances.ts` (soldes + suggestions), `GET /balances`, écran soldes « à recevoir / à payer », « qui paie la prochaine »                                                                                                                                     | Σ soldes = 0 (propriété) ; SQL ≡ moteur ; exemples du cahier des charges reproduits                                      |
| **6** Historique ✅                | Liste groupée par jour, filtres, page détail (parts → montants), révisions                                                                                                                                                                                       | Opérations annulées/refusées visibles                                                                                    |
| **7** Validation ✅                | Statuts, validate/reject/cancel, bulk tout-ou-rien, bannière « N à valider », audit                                                                                                                                                                              | Matrice de transitions testée exhaustivement ; PENDING sans effet sur soldes                                             |
| **8** Remboursements ✅            | Formulaire dédié, suggestions de virements → pré-remplissage                                                                                                                                                                                                     | Exemple Bob → Alice 30 € du cahier des charges                                                                           |
| **9** Cycle de vie ✅              | OPEN/SETTLEMENT/CLOSED, réouverture motivée, badge d'état, rotation du lien participant, gestion des admins                                                                                                                                                      | Matrice état × action testée ; clôture refusée si PENDING                                                                |
| **10** Admin desktop               | Layout `lg`, table dense (filtres, recherche, tri, sélection multiple), édition inline + panneau, audit, paramètres                                                                                                                                              | Parcours trésorier complet sur desktop                                                                                   |
| **11** Durcissement                | Tests API d'isolation sur toutes les routes, en-têtes/CSP, rate limits, Playwright mobile (parcours clés), accessibilité, perf, `docker-compose.prod.yml`, sauvegardes, doc d'exploitation                                                                       | Revue sécurité OK ; Lighthouse mobile ≥ 90                                                                               |

> 🟡 Phase 1 : tout est vérifié localement (lint, types, 50 tests, build, migrations, API + front lancés) sauf `docker compose up` lui-même
> (Docker absent de la machine de dev). Depuis le 2026-11-08, la CI GitHub est verte : lint, types, tests, build, construction des deux images Docker, validation du Caddyfile et des fichiers Compose.

> ✅ Phase 2 : création, liens participant/admin (hachés ; participant aussi chiffré, D17), authentification par en-tête,
> `/me`, `/nikount`, `/nikount/participant-link`, audit append-only, limites (créations par IP, tokens invalides par IP),
> écrans `/`, `/new`, « Vos liens », `/n/:token`, `/a/:token`. 131 tests ; parcours vérifié dans le navigateur.
> Reporté : bundle JS à alléger (668 Ko, surtout Zod et React Router) → Phase 11.

> ✅ Phase 3 : table `participant` (unicité des noms actifs, FK composite admin ↔ participant), participants saisis à la
> création (le créateur en tête s’il participe), `GET/POST/PATCH /participants` (désactivation au lieu de suppression,
> verrouillage optimiste, audit, 200 max, figé si clôturé), règles d’état centralisées dans `@nikount/core` (`isActionAllowed`).
> Front : saisie des participants à la création, « Qui êtes-vous ? » (identité déclarative mémorisée par appareil),
> liste sur l’accueil, page de gestion admin. 182 tests ; parcours vérifié dans le navigateur (mobile).
> Non fait (hors périmètre) : réordonner les participants dans l’interface (l’API accepte déjà `sortOrder`).

> ✅ Phase 4 : moteur de répartition `@nikount/core/split` écrit tests d’abord (exemples du cahier des charges + tests
> de propriétés fast-check : Σ parts = montant, écart < 1 centime, déterminisme), tables `transaction`, `transaction_share`,
> `transaction_revision` avec clés composites, contrainte différée « Σ parts = montant » et interdiction de suppression
> en base ; `POST/GET /transactions` (idempotence par `clientRequestId`, participant → `PENDING`, admin → `VALIDATED`,
> révision 1 + audit) ; formulaire mobile avec aperçu calculé par le même moteur que le serveur. 294 tests ; parcours
> vérifié dans le navigateur. L’API accepte déjà les remboursements (même moteur) ; leur écran arrive en Phase 8.

> ✅ Phase 5 : `@nikount/core/balances` (soldes, « qui paie la prochaine », virements suggérés) écrit tests d’abord
> (exemples du cahier des charges + propriétés : Σ soldes = 0, opérations non validées sans effet, ordre indifférent,
> virements qui soldent tout en ≤ n − 1). `GET /balances` calcule en SQL et refuse de répondre si Σ ≠ 0 ; tests
> « SQL ≡ moteur » sur des jeux aléatoires (tous modes, opérations en attente). Accueil : « Ton solde », à recevoir /
> à payer, qui paie la prochaine, opérations en attente, virements suggérés (dépliés en phase de règlement). 326 tests ;
> vérifié dans le navigateur côté admin et participant.

> ✅ Phase 6 : navigation basse Accueil · Dépenses · Remboursements · Menu ; historique groupé par jour (« Aujourd’hui »,
> « Hier », date), filtres Tout / Dépenses / Remboursements / En attente / Annulées-refusées, opérations annulées et
> refusées visibles (barrées) ; page détail (payeur, « 2 parts → 40 € », « 30 % → 36 € », mode, validation, refus ou
> annulation avec motif, traçabilité des versions) ; `GET /transactions/:id/revisions`. Participants et lien
> d’invitation déplacés dans « Menu ». 356 tests ; vérifié dans le navigateur.

> ✅ Phase 7 : matrice des transitions dans `@nikount/core/transitions` (testée exhaustivement) ; `validate`, `reject`,
> `cancel` et `bulk` (tout ou rien, verrouillage des lignes, conflit de version → 409, audit par opération). Front :
> bandeau « N opérations à valider », file de validation avec « Valider tout » confirmé, actions sur le détail (refus
> et annulation avec motif et confirmation), invisibles pour les participants et une fois le nikount clôturé.
> 417 tests ; vérifié dans le navigateur (validation puis annulation, soldes recalculés).

> ✅ Phase 8 : formulaire de remboursement (« qui rembourse → à qui », montant, libellé, date, résumé de l’effet),
> pré-rempli depuis un virement suggéré (`?from=&to=&amount=`, valeurs incohérentes ignorées) ; virements suggérés
> cliquables (sauf avec un participant désactivé ou nikount clôturé) ; boutons « + Ajouter une dépense » et
> « 💸 Remboursement » l’un sous l’autre ; onglet Remboursements avec bouton d’enregistrement ; en phase de règlement,
> dépenses fermées et message explicatif. Participant → en attente (D3), admin → validé. 434 tests ; vérifié dans le
> navigateur (virement suggéré → remboursement → validation → solde à zéro).

> ✅ Phase 9 : changements d’état dans `@nikount/core` (`nikountTransition` : terminer, déverrouiller, clôturer,
> réouvrir — motif obligatoire pour la réouverture, clôture refusée tant qu’une opération est en attente) et matrice
> état × action étendue (renommage, admins et lien du groupe restent possibles une fois clôturé). API :
> `POST /nikount/state`, `PATCH /nikount` (nom), `POST /nikount/participant-link/rotate`, `GET/POST /admins`,
> `POST /admins/:id/revoke` (pas de révocation du dernier admin actif ; 20 admins actifs max), verrouillage optimiste
> et audit partout. Le nikount est verrouillé en écriture (`FOR UPDATE`) pendant un changement d’état et en partage
> (`FOR SHARE`) pendant la création ou la validation d’une opération : une clôture ne peut pas croiser une nouvelle
> opération en attente. Front : écran « Gestion du nikount » (état avec confirmation et avertissement si les comptes
> ne sont pas soldés, nom, nouveau lien du groupe, admins avec lien affiché une seule fois), entrées depuis le menu et
> l’accueil (« Tout est soldé : clôturer »), message sur un nikount clôturé. 490 tests ; vérifié dans le navigateur.
> Non fait : test de concurrence réelle de la clôture (PGlite n’a qu’une connexion) → Phase 11.

## Stratégie de tests

| Niveau                   | Outil                                                           | Cible                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moteur (`packages/core`) | Vitest + fast-check                                             | Couverture ~100 % ; exemples métier + propriétés : somme des parts, somme des soldes nulle, déterminisme, ordre des entrées sans effet sur le total, montants jamais négatifs (hors AMOUNT=0) |
| Règles                   | Vitest                                                          | Matrices état × rôle × statut × action, exhaustives                                                                                                                                           |
| API                      | Vitest + `fastify.inject` + PostgreSQL réel (PGlite en mémoire) | Chaque route : succès, validation, 401/403/404, isolation inter-nikount, conflits de version                                                                                                  |
| E2E                      | Playwright (viewport mobile)                                    | Créer → ajouter dépense → valider → soldes → rembourser → clôturer                                                                                                                            |

## Hors MVP (backlog identifié)

QR code · PWA installable complète (service worker) · export CSV/PDF · temps réel (SSE) · multi-devises ·
pièces jointes · notifications · comptes utilisateurs · récupération de lien admin · i18n · purge des
nikounts anciens · pondérations par défaut par participant.
