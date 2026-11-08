# nikount — Produit

> Statut : **validé le 2026-11-08** (Phase 0). Les 🔶 renvoient aux décisions figées de [decisions.md](decisions.md).

## 1. Vision

nikount permet à un groupe (amis, famille, club, association) de partager les dépenses d'un événement
**sans compte et sans installation**.

**Un événement = un nikount = un lien privé.**

- Lien participant : `https://nikount.app/n/<token>` — lecture + saisie.
- Lien administrateur : `https://nikount.app/a/<token>` — un lien **distinct et personnel** par admin.

## 2. Personas

| Persona       | Contexte                            | Besoin principal                              |
| ------------- | ----------------------------------- | --------------------------------------------- |
| Participant   | Téléphone, une main, au restaurant  | Ajouter une dépense en < 10 s, voir son solde |
| Admin mobile  | Pendant l'événement                 | Valider les dépenses en attente, corriger     |
| Admin desktop | Après l'événement, trésorier d'asso | Vue dense, filtres, actions en masse, audit   |

## 3. Rôles et permissions

| Action                                              |     Participant     |      Admin       |
| --------------------------------------------------- | :-----------------: | :--------------: |
| Consulter nikount, participants, historique, soldes |         ✅          |        ✅        |
| Ajouter une dépense                                 |   ✅ → `PENDING`    | ✅ → `VALIDATED` |
| Enregistrer un remboursement                        | ✅ → `PENDING` 🔶D3 | ✅ → `VALIDATED` |
| Modifier une opération                              |       ❌ 🔶D4       |        ✅        |
| Valider / refuser (unitaire et en masse)            |         ❌          |        ✅        |
| Annuler une opération (unitaire et en masse)        |         ❌          |        ✅        |
| Gérer les participants                              |       ❌ 🔶D6       |        ✅        |
| Gérer les admins, paramètres, état du nikount       |         ❌          |        ✅        |
| Journal d'audit                                     |         ❌          |        ✅        |

### Identité sans compte

- **Admin** : identité _forte_ — chaque admin possède son propre lien secret, nominatif (« Nicolas »).
  C'est ce qui permet d'afficher « Validée par Nicolas » et d'auditer.
- **Participant** : identité _déclarative_ — au premier accès, l'appareil choisit « Je suis Bob »
  (mémorisé localement). Sert à pré-remplir le payeur et à tracer l'auteur déclaré.
  **Ce n'est jamais une autorisation** : tout porteur du lien participant peut se déclarer n'importe qui.
  C'est précisément pour cela que les opérations d'un participant passent par la validation.

## 4. Cycle de vie du nikount

```
        ┌──────── déverrouiller ────────┐
        ▼                               │
     OPEN ──── terminer ────► SETTLEMENT ──── clôturer ────► CLOSED
                                    ▲                           │
                                    └── réouvrir (exceptionnel, motif obligatoire, audité)
```

| Opération                                  | OPEN | SETTLEMENT |         CLOSED         |
| ------------------------------------------ | :--: | :--------: | :--------------------: |
| Créer une dépense                          |  ✅  |     ❌     |           ❌           |
| Créer un remboursement                     |  ✅  |     ✅     |           ❌           |
| Valider / refuser une opération en attente |  ✅  |     ✅     |           ❌           |
| Modifier / annuler (admin)                 |  ✅  |  ✅ 🔶D8   |           ❌           |
| Gérer participants / admins / paramètres   |  ✅  |     ✅     | admins & nom seulement |

Règles de transition :

- `SETTLEMENT → CLOSED` exige **zéro opération `PENDING`**. Des soldes non nuls déclenchent un
  avertissement, pas un blocage 🔶D9.
- L'« action administrative exceptionnelle » sur un nikount clos = **réouverture vers `SETTLEMENT`**
  avec motif, tracée dans l'audit. Il n'existe pas de porte dérobée qui modifie un nikount `CLOSED`.
- « Verrouiller / déverrouiller » du cahier des charges = passer en `SETTLEMENT` / revenir en `OPEN` 🔶D7.

L'état est affiché en permanence (badge en en-tête : _En cours_ / _Règlement_ / _Clôturé_).

## 5. Opération financière

Une dépense et un remboursement sont **la même entité** (`transaction`), avec un `type`.

| Champ       | Règle                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| Montant     | Entier en centimes, `> 0`, ≤ 1 000 000,00                                                                       |
| Description | 1–80 caractères (remboursement : par défaut « Remboursement »)                                                  |
| Payeur      | Exactement **un** participant actif                                                                             |
| Concernés   | **Un ou plusieurs** participants actifs, sans doublon. Le payeur peut ou non en faire partie                    |
| Répartition | `EQUAL`, `SHARES`, `PERCENT`, `AMOUNT`                                                                          |
| Date        | Date de l'événement (`occurred_on`), par défaut aujourd'hui (fuseau du nikount)                                 |
| Catégorie   | Optionnelle, liste fermée avec emoji (🍕 repas, ⛽ transport, 🛒 courses, 🏠 hébergement, 🎟 activité, 📦 autre) |
| Statut      | `PENDING`, `VALIDATED`, `REJECTED`, `CANCELLED`                                                                 |
| Auteur      | Admin (fort) ou participant déclaré + type d'auteur                                                             |
| Historique  | Révisions complètes + journal d'audit                                                                           |

### Remboursement (MVP)

- Payeur = celui qui donne l'argent ; concerné = celui qui le reçoit.
- Exactement **un** concerné, différent du payeur 🔶D5. Répartition forcée à `EQUAL` (1 part = montant).
- Le moteur comptable ne fait **aucune** différence de calcul entre les deux types.

## 6. Répartition

| Mode      | Saisie (`input_value`)                    | Contrainte                  | Arrondi           |
| --------- | ----------------------------------------- | --------------------------- | ----------------- |
| `EQUAL`   | 1 pour chaque concerné                    | —                           | Plus forts restes |
| `SHARES`  | Parts > 0, 2 décimales max (0,5 autorisé) | Somme > 0                   | Plus forts restes |
| `PERCENT` | Pourcentage, 2 décimales max              | Somme = 100,00 % exactement | Plus forts restes |
| `AMOUNT`  | Montant en centimes ≥ 0                   | Somme = montant exactement  | Aucun             |

**Arrondi — méthode des plus forts restes (Hamilton)**, en entiers uniquement :

1. Pour chaque concerné : `exact_i = montant × poids_i / Σpoids` (rationnel).
2. `base_i = ⌊exact_i⌋` centimes.
3. Les centimes restants (`montant − Σbase_i`, toujours < nombre de concernés) sont attribués un par un
   aux plus grands restes fractionnaires ; égalité départagée par l'ordre des participants 🔶D2.

**Invariant absolu : Σ `share.amount` = `transaction.amount`**, vérifié par le moteur, le service
et la base de données.

Exemple : 100,00 € en `EQUAL` sur 3 → 33,34 / 33,33 / 33,33.

Le montant final de chaque ligne est **stocké** ; un changement futur de l'algorithme n'altère jamais
les opérations passées.

## 7. Soldes

```
solde(p) = Σ montants des opérations VALIDATED payées par p
         − Σ parts de p dans les opérations VALIDATED
```

- Seules les opérations `VALIDATED` comptent. `PENDING`, `REJECTED`, `CANCELLED` : 0 effet.
- **Invariant : Σ soldes = 0** sur tout nikount.
- Solde > 0 : « à recevoir ». Solde < 0 : « à payer ». Solde = 0 : « à l'équilibre ».

### Aides UX (jamais d'effet sur les comptes)

- **« Qui paie la prochaine ? »** → participant actif au solde le plus négatif.
- **Suggestions de remboursement** (surtout en `SETTLEMENT`) : liste minimale de virements
  « Bob → Alice 42,00 € » calculée par appariement glouton débiteurs/créanciers. Un tap pré-remplit
  un remboursement 🔶D10.

## 8. Historique

- Groupé par jour (`occurred_on` décroissant, puis heure de création) : « Aujourd'hui », « Hier », date.
- Ligne : emoji catégorie, description, payeur (ou « Bob → Alice »), montant, badge de statut si ≠ validé.
- Les opérations `CANCELLED` et `REJECTED` restent visibles (barrées / grisées) et filtrables.
- Page détail : montant, payeur, concernés avec saisie → montant (« 2 parts → 40,00 € »,
  « 30 % → 36,00 € »), mode de répartition, auteur, validation (« Validée par Nicolas, 28/09/2026 20:42 »),
  annulation/refus avec motif, liste des révisions.

## 9. Suppression et traçabilité

- **Aucune opération financière n'est supprimée physiquement.** L'annulation passe le statut à
  `CANCELLED` (motif optionnel, auteur, date).
- Un participant ne peut pas être supprimé s'il apparaît dans une opération : il est **désactivé**.
- Chaque modification d'une opération crée une **révision** (instantané complet).
- Chaque action sensible écrit un **événement d'audit** append-only.

## 10. Validation

```
PENDING ──valider──► VALIDATED ──annuler──► CANCELLED
   │
   └──refuser──► REJECTED
```

- `REJECTED` et `CANCELLED` sont terminaux.
- Une opération `PENDING` peut aussi être annulée (ex. doublon) — équivalent fonctionnel de « refuser ».
  On garde les deux statuts car le sens diffère (refus admin vs retrait).
- L'admin voit une bannière « 3 dépenses à valider » et dispose de « Valider tout » et de la validation unitaire.

## 11. Hors MVP (identifié explicitement)

Comptes utilisateurs, multi-devises / conversion, pièces jointes (tickets), notifications push/email,
QR code (architecture prête), offline complet, export CSV/PDF, catégories personnalisées,
pondérations par défaut par participant, identité forte des participants, récupération de lien admin
perdu, internationalisation (FR uniquement au MVP, textes centralisés).
