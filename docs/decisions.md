# nikount — Décisions (figées)

> **Statut : figé le 2026-11-08.** Toutes les recommandations ci-dessous ont été validées telles quelles.
> Les alternatives restent documentées pour mémoire ; changer une décision figée implique de mettre
> à jour cette page, la doc concernée et les tests.

Chaque point est une ambiguïté du cahier des charges ou un choix structurant.

## Ambiguïtés produit

| #       | Question                                                                                   | ✅ Décision retenue                                                                                                             | Alternative écartée                                                                                      |
| ------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **D1**  | Où placer le token dans l'URL ?                                                            | `/n/<token>` (conforme au cahier des charges), avec logs masqués et `no-referrer`                                               | `/n#<token>` : jamais envoyé au serveur ni journalisé, mais URL moins « propre »                         |
| **D2**  | À qui vont les centimes d'arrondi ?                                                        | Plus forts restes, égalité départagée par l'ordre des participants (simple, déterministe, écart ≤ 1 centime/personne/opération) | Départage pseudo-aléatoire déterministe (seed = id d'opération) pour répartir les centimes dans le temps |
| **D3**  | Un remboursement saisi par un participant doit-il être validé ?                            | **Oui**, même règle que les dépenses : sinon un participant peut effacer sa dette d'un tap                                      | Remboursements validés d'office (plus fluide, moins sûr)                                                 |
| **D4**  | Un participant peut-il modifier/retirer sa propre opération `PENDING` ?                    | **Non au MVP** (l'admin corrige ou refuse ; pas d'identité forte pour savoir qui est « l'auteur »)                              | Oui, depuis le même appareil (identifiant d'appareil local, non sécurisé)                                |
| **D5**  | Remboursement vers plusieurs personnes ?                                                   | **Non** : 1 payeur → 1 concerné. Plusieurs remboursements sinon. Le moteur le supporterait sans changement                      | Autoriser N concernés                                                                                    |
| **D6**  | Un participant peut-il ajouter un nouveau participant (« je ne suis pas dans la liste ») ? | **Non**, admin uniquement                                                                                                       | Oui, ajout direct ou « demande » à valider                                                               |
| **D7**  | « Verrouiller » est-il un état distinct ?                                                  | Non : verrouiller = passer en `SETTLEMENT`, déverrouiller = revenir en `OPEN`                                                   | Drapeau `locked` indépendant de l'état (gel temporaire en `OPEN`)                                        |
| **D8**  | En `SETTLEMENT`, l'admin peut-il modifier/annuler des dépenses existantes ?                | **Oui** (corrections tardives nécessaires), audité                                                                              | Non, il faut repasser en `OPEN`                                                                          |
| **D9**  | Peut-on clôturer avec des soldes non nuls ?                                                | **Oui avec avertissement** (on ne court pas après 0,02 €, ou dette réglée hors app)                                             | Bloquer tant que les soldes ne sont pas nuls (± tolérance)                                               |
| **D10** | Afficher des suggestions de virements pour solder ?                                        | **Oui** (MVP) : indispensable en phase de règlement, purement indicatif                                                         | Seulement « qui paie la prochaine »                                                                      |
| **D11** | Lien admin perdu ?                                                                         | Pas de récupération au MVP ; écran « Vos liens » insistant + invitation à créer un 2e admin                                     | Email facultatif de récupération (implique stockage de données personnelles)                             |
| **D12** | Un admin est-il forcément participant ?                                                    | Non : lien optionnel `admin_access.participant_id` (cas du trésorier d'asso)                                                    | Admin = toujours un participant                                                                          |
| **D13** | Modifier une opération validée : modification en place ou annulation + recréation ?        | **En place avec révision** (une seule ligne d'historique, détail des changements)                                               | Annuler + recréer (deux lignes, plus lourd à lire)                                                       |
| **D14** | Une opération dont le payeur n'est pas concerné est-elle permise ?                         | **Oui** (« j'ai payé les courses des enfants »)                                                                                 | —                                                                                                        |
| **D15** | Une dépense `PENDING` apparaît-elle dans les soldes ?                                      | Non (règle du cahier des charges) ; affichée « ⏳ en attente » dans l'historique et en total séparé                             | Afficher un « solde projeté » (hors MVP)                                                                 |
| **D16** | Devise                                                                                     | Une devise par nikount (EUR par défaut), aucune conversion                                                                      | Multi-devises (hors MVP)                                                                                 |

## Choix techniques

| #      | Choix                    | ✅ Décision retenue                                                                                                                                                |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **T1** | Backend                  | Node 26 LTS + Fastify + TypeScript (moteur comptable partagé avec le front) — voir [architecture.md](architecture.md#pourquoi-node--typescript-plutôt-que-fastapi) |
| **T2** | Accès DB                 | Drizzle ORM + migrations SQL versionnées                                                                                                                           |
| **T3** | Représentation monétaire | Entiers en unités mineures partout (DB `bigint`, JS `number` avec contrôle `Number.isSafeInteger`)                                                                 |
| **T4** | Soldes                   | Calculés à la lecture, aucune table de soldes                                                                                                                      |
| **T5** | Admin desktop            | Même SPA, layout différent à partir de `lg`                                                                                                                        |
| **T6** | Auth                     | En-tête `Authorization: Bearer`, pas de cookie (donc pas de CSRF)                                                                                                  |

## Règles métier figées

1. Une opération a exactement un payeur actif et ≥ 1 concerné actif, sans doublon.
2. Σ des parts = montant, au centime, pour toute opération, quel que soit le mode.
3. `PERCENT` : Σ = 100,00 % exactement. `AMOUNT` : Σ = montant exactement. `SHARES` : chaque part > 0.
4. Seules les opérations `VALIDATED` modifient les soldes. Σ des soldes = 0.
5. Transitions de statut autorisées : `PENDING→VALIDATED|REJECTED|CANCELLED`, `VALIDATED→CANCELLED`. Rien d'autre.
6. Aucune suppression physique d'opération ; toute modification crée une révision ; toute action sensible un événement d'audit.
7. Matrice état du nikount × action ([product.md §4](product.md)).
8. Un participant ne crée que des opérations `PENDING` ; un admin crée directement des `VALIDATED`.
9. Les montants stockés font foi ; ils ne sont jamais recalculés a posteriori.
10. Il reste toujours au moins un admin actif.

## Risques principaux

| Risque                                   | Impact                                     | Mitigation                                                                                      |
| ---------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Erreur dans le moteur comptable          | Critique (confiance)                       | Moteur pur isolé, test-first, tests de propriétés, invariants en base, comparaison SQL ≡ moteur |
| Perte du lien admin                      | Nikount bloqué                             | D11, multi-admins encouragé                                                                     |
| Fuite du lien participant                | Saisie de fausses dépenses                 | Validation obligatoire, rotation du lien                                                        |
| Fuite du lien admin                      | Prise de contrôle                          | Révocation individuelle, audit, `last_used_at`                                                  |
| Double saisie sur réseau mobile instable | Doublons                                   | `clientRequestId` idempotent                                                                    |
| Deux admins modifient en même temps      | Écrasement                                 | Verrouillage optimiste (`version`, 409)                                                         |
| PWA iOS : stockage séparé de Safari      | « Mes nikounts » vide dans l'app installée | Documenter ; rouvrir le lien depuis l'app ; QR plus tard                                        |
| XSS → vol des tokens en `localStorage`   | Accès aux nikounts                         | CSP stricte, zéro script tiers, lint                                                            |
| Dérive du périmètre                      | Retard MVP                                 | Backlog « hors MVP » explicite dans [roadmap.md](roadmap.md)                                    |
