# Comptabilité intégrée — conception

Passport remplace Dolibarr. Ce document fixe le modèle et les décisions prises avec le CA le
27 septembre 2026 ; c'est la référence quand une question de périmètre se pose. Il décrit la cible
complète — les phases ci-dessous disent ce qui est livré et ce qui ne l'est pas encore.

## Périmètre

- Tiers (clients, fournisseurs, sponsors, adhérents, membres) et leurs liens.
- Cotisations et sponsorings, avec le droit de membre qui en découle.
- Factures émises (lignes, numérotation, PDF, UBL téléchargeable) et reçues.
- Banque et caisse : comptes, mouvements, import CSV Belfius, virements internes, lettrage.
- Notes de frais soumises par les membres, validées par la trésorerie.
- Livre journal simplifié et pièces pour la publication des comptes annuels (petite ASBL).

Hors périmètre : TVA (l'ASBL est en franchise, voir plus bas), devises autres que l'euro,
envoi Peppol automatisé (le dépôt se fait à la main sur Doccle).

## Rôles Passport

| Groupe Authentik | Voit |
| --- | --- |
| membre (tout compte) | sa propre situation : cotisation, factures de sa société s'il en est administrateur, ses notes de frais |
| `Passport Admin` | l'administration des comptes (existant) — **pas** le détail comptable |
| `Trésorier` (`PUBLIC_AUTHENTIK_TRESORIER_GROUP`) | tout le module `/compta` |

Un admin qui n'est pas trésorier ne voit pas la compta. Les deux groupes se cumulent.

## Tiers

Une seule table `tiers`. Un tiers a une **nature** (`personne_physique` ou `personne_morale`) ;
ses **rôles** ne sont pas une énumération mais des faits cumulables — une société peut être
sponsor et cliente, une personne adhérente et fournisseur :

- `est_client`, `est_fournisseur` : drapeaux, posés à la main ou à la première facture.
- adhérent : a des cotisations.
- sponsor : a des cotisations de type `sponsoring`.
- **membre : jamais stocké**, toujours calculé (voir plus bas).

Une personne physique qui a un compte Passport porte `authentik_pk`, le même entier que le `sub`
du jeton OIDC (voir `authentikPk()` dans `src/lib/types.ts`) — c'est la clef entre les deux
mondes, plus fiable que l'email que Dolibarr imposait.

`exempte_cotisation` remplace le type d'adhérent « membre d'honneur » de Dolibarr (type sans
cotisation requise) : la personne est membre sans payer.

### Liens personne ↔ société

`tiers_liens` relie une personne physique à une personne morale. Une ligne porte des rôles
cumulables — `est_employe`, `est_administrateur` (preneur de décision : voit les factures de la
société dans Passport), `est_contact` (personne de contact, une ou plusieurs), et
`destinataire_factures` (reçoit les factures par email) — plus `herite_adhesion` : cette
personne consomme-t-elle un siège de la cotisation de la société ? Un lien a une période
(`depuis`, `jusqua` nullable) ; il n'est pas supprimé quand la personne part, il est clos.

Le nombre de liens `herite_adhesion` en cours d'une société ne peut pas dépasser les `sieges`
de sa cotisation courante. C'est vérifié à l'écriture du lien.

## Cotisations

Une table `cotisations`, trois types :

| `type` | qui | montant | `sieges` | création |
| --- | --- | --- | --- | --- |
| `libre` | personne physique | quel qu'il soit | 1 | par la trésorerie au lettrage d'un paiement, durée fixée d'après la communication, le montant ou ce que le membre a dit |
| `facturee` | société adhérente | prix de l'abonnement | ceux de l'abonnement (défini au contrat) | générée avec la facture, au début de chaque période |
| `sponsoring` | société sponsor | libre | fixés sur la facture | à la main, période choisie sur la facture |

Une cotisation couvre `[debut, fin)` : **`fin` est exclusive**, c'est le premier jour non
couvert. Deux cotisations qui se suivent ont donc `fin` de l'une = `debut` de la suivante,
sans tolérance ni artefact de bornes (Dolibarr stockait une fin inclusive à 23 h, d'où la
tolérance de 24 h de l'ancien code). Les dates sont des `DATE` calendaires, lues en UTC comme
les mois de trous le sont déjà.

`statut` : `attendue` (facture émise, pas encore payée) → `active` (payée, ou `libre` créée
directement active) ; `annulee` sinon. **Une cotisation facturée ne donne le droit qu'une fois
payée** ; entre-temps le délai de grâce ci-dessous fait le pont.

Une société adhérente a un `abonnement` : `prix`, `periodicite` (`mois` | `annee`), `sieges`,
`prochaine_echeance`. Un planificateur (même mécanisme que `birthdayScheduler`) émet la facture
et la cotisation `attendue` à chaque échéance, puis avance l'échéance.

## Droit de membre (calculé)

Pour une personne physique P à l'instant t :

```
couvert(P, t) ⇔ P.exempte_cotisation
              ∨ ∃ cotisation active de P avec debut ≤ t < fin
              ∨ ∃ lien(P → S) en cours avec herite_adhesion
                  ∧ ∃ cotisation active de S avec debut ≤ t < fin
```

Le statut affiché en découle, avec le **délai de grâce** `compta_settings.delai_grace_jours`
(réglé par la trésorerie, 90 jours par défaut) :

| statut | condition |
| --- | --- |
| `non_applicable` | exempté (membre d'honneur) |
| `a_jour` | couvert à t |
| `en_grace` | plus couvert, mais dernière fin de couverture + délai de grâce > t |
| `expiree` | plus couvert depuis plus longtemps que le délai de grâce |
| `en_attente` | jamais eu de couverture |

Le statut se calcule aussi bien pour la personne que pour la société (sans la partie « lien »),
et la raison est conservée pour l'affichage (« via votre cotisation » / « via Société X »).

**Membre ⇔ compte Authentik.** Quand un statut passe à `expiree`, Passport désactive le compte
Authentik ; un lien avec siège sur une personne sans compte déclenche une invitation
(`createInvitation`, existant). La détection des trous de cotisation (mois non perçus) est
reprise telle quelle de l'ancien `dolibarr.ts`, adaptée aux fins exclusives.

## Factures

`factures` (`sens` : `emise` | `recue`) et `facture_lignes`. Une facture émise est en
`brouillon` tant qu'elle se modifie ; à la **validation** elle reçoit son numéro, son PDF est
généré et stocké dans Postgres (colonne `bytea`, une seule chose à sauvegarder), et elle devient immuable — une correction passe par une note de
crédit (`type = 'note_de_credit'`, `facture_origine_id`). Statuts : `brouillon` → `validee` →
`payee`, ou `annulee` (brouillon seulement).

- **Numérotation** : séquentielle sans trou, par année, `AAAA-NNNN`, attribuée sous
  `pg_advisory_xact_lock` comme les migrations.
- **Communication structurée** belge `+++NNN/NNNN/NNNNN+++` (mod 97) dérivée du numéro, imprimée
  sur la facture pour le lettrage automatique.
- **TVA** : l'ASBL est en franchise (art. 56bis CTVA). Chaque facture porte la mention
  « Régime particulier de franchise des petites entreprises — TVA non applicable », un taux de
  0 % et aucun numéro de TVA. Il n'y a ni taux ni base par ligne à gérer.
- **PDF** généré côté serveur sans navigateur (`pdfkit`) — le conteneur tourne en lecture seule
  sans capacités, Chromium n'y a pas sa place.
- **UBL** : XML Peppol BIS Billing 3.0 téléchargeable à côté du PDF, déposé à la main sur
  Doccle. Exonération en catégorie de taxe `E` avec la raison textuelle ; le code `VATEX`
  exact pour le régime de franchise reste à confirmer avec le comptable avant l'écrire.
- Factures **reçues** : métadonnées, PDF déposé, UBL importé si le fournisseur en fournit.

Un membre voit ses factures et, s'il est `est_administrateur` d'une société, celles de la
société. La route `/cotisation/invoice/[id]` garde son contrôle « c'est bien la mienne ».

## Banque et caisse

- `comptes` : `type` (`banque` | `caisse`), nom, IBAN, solde d'ouverture.
- `mouvements` : compte, date de valeur, montant signé, libellé, contrepartie (nom, IBAN),
  communication, `import_id`, `external_id` pour dédoublonner les ré-imports.
- Virement interne : deux mouvements opposés créés atomiquement, liés par `transfert_id`.
- `lettrages` : un mouvement ↔ une cible (`facture`, `cotisation`, `note_de_frais`, `autre`)
  pour un montant. Une ligne par affectation : un paiement couvre plusieurs factures, un paiement
  partiel est possible. Une facture passe à `payee` quand la somme lettrée atteint son total ;
  une cotisation `attendue` passe à `active`.
- Import : **CSV Belfius** d'abord (export « CSV » de Belfius Direct Net : `Compte;Date de
  comptabilisation;N° d'extrait;N° de transaction;Compte contrepartie;Nom contrepartie…;Transaction;
  Date valeur;Montant;Devise;…;Communications`, point-virgule, montants `1.234,56`, dates
  `jj/mm/aaaa` ; le lecteur repère l'en-tête par ses intitulés et tolère un préambule). CODA
  (commun aux banques belges) ensuite si utile.
- Auto-lettrage à l'import sur la communication structurée ; le reste est proposé à la
  trésorerie, qui tranche (c'est là qu'une cotisation `libre` naît).

## Notes de frais

Tout membre soumet une note (libellé, montant, justificatif, date). La trésorerie accepte ou
refuse depuis un tableau ; une note acceptée devient une cible de lettrage pour le remboursement
sur l'IBAN du tiers.

## Sorties comptables

Petite ASBL, comptabilité simplifiée (AR du 26 juin 2003) : livre journal des recettes et
dépenses, état du patrimoine, et l'état des recettes/dépenses au format de dépôt au greffe.
Générés depuis les mouvements lettrés et les pièces — pas de plan comptable en partie double.

## Emails et notifications

Aucun envoi d'email n'existe dans Passport aujourd'hui (les invitations passent par Authentik).
Un transport SMTP est ajouté pour les factures et rappels ; les détails (expéditeur, serveur)
sont fixés plus tard. Mattermost (bot existant) sert aux notifications internes.

## Migration depuis Dolibarr

Tout l'historique est importé — tiers, adhérents et leurs souscriptions (indispensable pour les
trous de cotisation), factures avec leurs PDF archivés, comptes bancaires. L'import est un
module serveur lancé depuis `/compta/import` par un trésorier, avec un aperçu à blanc avant
application ; il est idempotent (clefs `dolibarr_*_id`) et peut être rejoué. Correspondances :

| Dolibarr | Passport |
| --- | --- |
| adhérent `morphy = phy` | tiers `personne_physique` (+ lien vers le tiers de `fk_soc` s'il existe) |
| adhérent `morphy = mor` | tiers `personne_morale` (depuis `fk_soc`) ; nom/prénom de l'adhérent → personne physique liée, `est_contact` |
| type d'adhérent sans cotisation | `exempte_cotisation` |
| souscription `[dateh, datef]` | cotisation `[debut, datef + 1 jour)` |
| tiers `client` / `fournisseur` | `est_client` / `est_fournisseur` |
| facture client (statut ≥ validée) | facture `emise`, PDF archivé, numéro Dolibarr conservé dans `reference_externe` |
| facture fournisseur | facture `recue`, numéro du fournisseur, montant TTC payé |
| compte bancaire (type 1 banque, 2 caisse) et ses écritures | `comptes` et `mouvements` (`external_id` = `dolibarr-<id>`) |

Le rapprochement adhérent ↔ compte Authentik se fait par email à l'import (c'est tout ce que
Dolibarr a), puis `authentik_pk` fait foi.

## Phases

1. **Tiers, liens, cotisations, abonnements, rôle Trésorier, import Dolibarr** ; le statut de
   cotisation, l'historique et les IBAN sont lus dans Postgres. *(livré)*
2. **Factures émises et reçues** : lignes, numérotation, PDF, notes de crédit, abonnements et
   génération planifiée ; import des factures Dolibarr ; plus rien ne lit Dolibarr au runtime,
   `dolibarr.ts` ne sert plus qu'à l'import. *(livré)*
3. **Banque et caisse** : comptes, mouvements, import Belfius, lettrage (automatique sur la
   communication structurée, manuel sinon), virements internes ; import des comptes et écritures
   Dolibarr. *(livré)*
4. **UBL**, factures reçues, SMTP.
5. Notes de frais, livre journal et comptes annuels, désactivation Authentik automatique.
