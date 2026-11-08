# nikount — Sécurité

> Statut : **validé le 2026-11-08** (Phase 0). Les 🔶 renvoient aux décisions figées de [decisions.md](decisions.md).

## 1. Modèle de menace

| Actif                      | Menace                                 | Mesure                                                                                               |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Lien participant           | Transféré hors du groupe, deviné       | 128 bits d'entropie ; **rotation** par un admin ; validation obligatoire des saisies participants    |
| Lien admin                 | Fuite (capture d'écran, historique)    | Un lien **par admin**, révocable individuellement ; jamais affiché après création sauf à son porteur |
| Lien admin perdu           | Plus aucun admin                       | Encourager ≥ 2 admins ; pas de récupération au MVP 🔶D11                                             |
| Données d'un autre nikount | IDOR                                   | Aucun `nikount_id` côté client ; repositories filtrés ; FK composites                                |
| Comptes                    | Opération falsifiée par un participant | `PENDING` + validation admin ; auteur déclaré tracé                                                  |
| Historique                 | Effacement / réécriture                | Pas de DELETE (trigger), révisions, audit append-only                                                |
| Tokens en `localStorage`   | XSS                                    | CSP stricte, aucun script tiers, pas de HTML injecté                                                 |
| API                        | Brute force, abus                      | Rate limiting, tailles de corps limitées                                                             |

## 2. Tokens

- Générés par `crypto.randomBytes(16)` (participant, 128 bits) et `crypto.randomBytes(32)` (admin, 256 bits),
  encodés en base64url. Préfixe lisible non secret pour distinguer les types côté support (`p_…` / `a_…`).
- Recherche par `sha256(token)` uniquement. Le lien admin n'est stocké que sous cette forme. Le lien participant est en plus stocké **chiffré** (AES-256-GCM, clé `TOKEN_ENCRYPTION_KEY` hors base) pour que les admins puissent le réafficher (D17) : un dump de la base seule ne donne aucun accès. Perdre la clé rend les liens participants non réaffichables (ils restent valides).
  (Pas besoin de bcrypt/argon2 : l'entropie du token rend la force brute hors d'atteinte.)
- Recherche par index sur le hash → pas de comparaison caractère par caractère exploitable.
- **Séparation stricte** : un token participant ne résout jamais vers un rôle admin ; aucun endpoint ne
  « promeut » un token. Le token participant n'est **pas** dérivable du token admin et inversement.
- Rotation du lien participant : l'ancien cesse immédiatement de fonctionner.

### Exposition du token dans l'URL

Le lien `/n/<token>` est par nature dans l'historique du navigateur et les messageries. Mesures :

- `Referrer-Policy: no-referrer` ; aucune ressource tierce (polices et icônes auto-hébergées).
- Le token **n'apparaît jamais dans les URL de l'API** (en-tête `Authorization` uniquement).
- Logs d'accès Caddy : chemins `/n/*` et `/a/*` masqués ; logs API : en-tête `Authorization` masqué (pino `redact`).
- Alternative à décider : token dans le fragment (`/n#<token>`), jamais envoyé au serveur 🔶D1.

## 3. Autorisation (anti-IDOR)

1. Plugin `auth` : token → `AccessContext { nikountId, role, adminId? }` ou `401`.
2. Garde de rôle déclarative par route (`requireAdmin`).
3. Les services reçoivent le contexte, jamais un `nikountId` venant du corps ou de l'URL.
4. Chaque repository prend `nikountId` en **premier paramètre obligatoire** (typage).
5. Les références croisées (payeur, concernés, admin lié) sont vérifiées par le service **et** par les FK composites.
6. Matrice de permissions et d'états centralisée dans `@nikount/core/rules.ts`, testée exhaustivement.
7. Test API générique : pour chaque route, un token du nikount B ne peut ni lire ni modifier une ressource du nikount A.

## 4. Validation des données

- Zod strict sur chaque entrée (types, bornes, longueurs, enums, champs inconnus refusés).
- Textes : trim, normalisation NFC, suppression des caractères de contrôle, longueur max.
- Montants : entiers, `1 ≤ amount ≤ 100 000 000`. Parts/pourcentages : 2 décimales max.
- Corps limité à 64 Ko ; listes bornées (≤ 200 concernés, ≤ 200 ids en masse).

## 5. Web

- **CSRF** : l'API n'utilise **aucun cookie** ; l'authentification passe par un en-tête explicite → pas de
  surface CSRF. CORS : même origine uniquement (aucun `Access-Control-Allow-Origin` en prod).
- **XSS** : rendu React (échappement par défaut), interdiction de `dangerouslySetInnerHTML` (règle ESLint),
  CSP : `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`.
- En-têtes : `Strict-Transport-Security` (HSTS), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` restrictive.
- HTTPS obligatoire en production (Caddy, redirection HTTP → HTTPS).

## 6. Sessions

Pas de session serveur : chaque requête porte son token (API sans état). La « session » côté client est
l'entrée `localStorage` du nikount ; « Oublier ce nikount » la supprime. Révocation effective immédiatement
(contrôle à chaque requête). `last_used_at` permet à un admin de repérer un accès inutilisé.

## 7. Rate limiting (`@fastify/rate-limit`, mémoire, instance unique)

| Cible                   | Limite (proposition)             |
| ----------------------- | -------------------------------- |
| `POST /nikounts` par IP | 10 / heure                       |
| Réponses `401` par IP   | 20 / 10 min, puis blocage 15 min |
| Écritures par token     | 60 / min                         |
| Lectures par token      | 300 / min                        |

`TRUST_PROXY` configuré pour lire la vraie IP derrière Caddy.

## 8. Audit

Actions auditées : création du nikount, changements d'état, création/modification/validation/refus/annulation
d'opération (unitaire et en masse), gestion des participants, création/révocation d'admin, rotation du lien
participant, modification des paramètres. Écrites dans la même transaction SQL que l'action.

## 9. Données personnelles

Uniquement des prénoms/surnoms et des montants. Pas d'email, pas de téléphone, pas d'adresse IP stockée
en base (IP seulement dans les logs, rétention courte). Politique de conservation / purge des nikounts clos : hors MVP, à définir.

## 10. Chaîne d'approvisionnement et secrets

- Secrets uniquement en variables d'environnement ; `.env` dans `.gitignore` ; `.env.example` sans valeur réelle.
- `pnpm audit` + Dependabot/Renovate ; lockfile versionné ; images Docker épinglées, utilisateur non-root.
- Rôle PostgreSQL applicatif sans droits DDL en production (migrations via un rôle séparé).
