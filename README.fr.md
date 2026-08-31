# Passport3

*[Read this in English](README.md)*

Passport3 est le portail des membres du [Liège Hackerspace](https://lghs.be).

Il offre une interface unique et conviviale permettant aux membres de gérer leur identité, leur adhésion, leurs cotisations, leurs droits d'accès et d'autres informations liées au hackerspace.

Passport3 sert d'interface personnalisée pour plusieurs services internes, notamment :

- **Authentik** pour l'authentification et la gestion d'identité
- **Dolibarr** pour les adhésions, cotisations et paiements
- **GitHub** pour demander l'accès à l'organisation du hackerspace
- **Les systèmes de contrôle d'accès** pour l'accès physique au hackerspace
- D'autres services communautaires et de gestion des membres

## Objectifs

Passport3 vise à offrir aux membres un endroit central pour :

- [x] Consulter et mettre à jour leurs informations personnelles
- [x] Vérifier le statut de leur adhésion
- [x] Consulter leurs cotisations passées et en cours, y compris les paiements manquants ou irréguliers
- [x] Gérer l'authentification et les paramètres de sécurité (sessions actives, appareils MFA)
- [x] Gérer leurs badges ou identifiants d'accès (UUID du badge RFID)
- [x] Demander l'accès à l'organisation GitHub du hackerspace
- [x] Accéder à l'annuaire des membres et au trombinoscope
- [x] Choisir quelles informations sont visibles par les autres membres
- [x] Gérer ses contacts d'urgence
- [ ] Accéder aux informations de paiement et de comptabilité
- [ ] Voir leurs droits d'accès physique
- Accéder aux futurs services du hackerspace via une interface unifiée

## Intégrations

### Authentik

Authentik est utilisé comme fournisseur d'identité et backend d'authentification.

Passport3 fournit une interface personnalisée pour les membres tout en s'appuyant sur Authentik pour :

- L'authentification
- Le Single Sign-On
- Les identités utilisateur
- Les groupes et rôles
- La sécurité et la gestion des sessions

### Dolibarr

Dolibarr est utilisé pour la gestion administrative et financière des adhésions.

Passport3 communique avec Dolibarr pour récupérer ou gérer :

- Les fiches des membres
- Les cotisations d'adhésion
- Les dates d'expiration des cotisations
- Les paiements
- Les factures et documents justificatifs
- Le statut administratif d'adhésion
- Les coordonnées bancaires personnelles et professionnelles (IBAN)

### GitHub

Passport3 permet aux membres de demander eux-mêmes l'accès à l'organisation GitHub du hackerspace, sans passer par un·e admin.

Le processus repose sur deux identifiants séparés, chacun avec le minimum de droits nécessaires :

- Une **OAuth App GitHub** vérifie que le membre possède réellement le compte GitHub qu'il souhaite lier (simple vérification d'identité en lecture seule, aucun accès à l'organisation).
- Une **GitHub App**, installée sur l'organisation avec uniquement la permission "Members: Read and write", est le seul identifiant privilégié qui envoie réellement l'invitation une fois l'identité confirmée.

Un membre ne peut lier et inviter que son propre compte — jamais celui de quelqu'un d'autre — et peut voir s'il est déjà membre, déjà invité, ou ni l'un ni l'autre.

### Contrôle d'accès

Passport3 fait l'interface entre les membres et l'infrastructure de contrôle d'accès du hackerspace.

Selon le matériel et la configuration déployés, cela peut inclure :

- La consultation des droits d'accès
- La gestion des badges ou identifiants d'accès
- La demande ou l'activation d'un accès
- La consultation du statut d'un identifiant
- La révocation d'un identifiant perdu
- La synchronisation des droits d'accès avec le statut d'adhésion

### Panneau d'administration

Un panneau d'administration restreint (réservé à un groupe Authentik dédié) permet à des membres désigné·es de :

- Lister et rechercher les comptes membres
- Modifier le profil d'un membre en son nom
- Créer des invitations d'inscription pour de nouveaux membres

## Fonctionnalités prévues

- Renouvellement de cotisation en ligne
- Historique des paiements
- Téléchargement de factures et documents
- Gestion de l'accès physique
- Annuaire des membres et trombinoscope, avec contrôle de visibilité par membre et par champ
- Préférences de notification
- Historique d'audit
- API pour les autres services du hackerspace

## Vie privée

Passport3 traite des données personnelles appartenant aux membres du hackerspace.

Le projet suit les principes suivants :

- Minimisation des données
- Finalité explicite
- Accès selon le moindre privilège
- Transparence envers l'utilisateur
- Conservation limitée
- Stockage sécurisé
- Visibilité contrôlée par le membre

Les informations privées des membres ne doivent jamais être exposées via l'annuaire ou les API sans règle d'autorisation explicite.

## Déploiement preprod

`docker-compose.yml` construit l'image depuis les sources (dev local). `docker-compose.preprod.yml` récupère à la place l'image construite par la CI (`.github/workflows/docker-release.yml`) depuis GHCR, et lance Watchtower en parallèle pour la mettre à jour automatiquement à chaque nouvelle version.

Le package `ghcr.io/lghs/passport3` est **public**, donc aucune connexion au registre n'est nécessaire, ni sur l'hôte preprod ni pour Watchtower. Après la toute première release (le package n'existe pas dans GHCR avant ça), passez sa visibilité en public une fois, depuis l'onglet Packages du repo (Package settings → Change visibility).

Mise en place sur l'hôte preprod :

```bash
docker compose -f docker-compose.preprod.yml up -d
```

Publier une nouvelle version (`git tag vX.Y.Z && git push --tags`, ou `gh release create vX.Y.Z`) construit et pousse `ghcr.io/lghs/passport3:X.Y.Z` et `ghcr.io/lghs/passport3:preprod` — Watchtower détecte la mise à jour du tag `preprod` dans les 5 minutes et redéploie automatiquement.

## Contribuer

Les contributions sont les bienvenues.

Passport3 est développé pour la communauté du Liège Hackerspace. Les problèmes, suggestions et pull requests peuvent être soumis via le dépôt du projet.

Merci de ne jamais inclure de données personnelles de membres, d'identifiants, de clés API ou de configuration de production dans les issues ou contributions.

## Nom du projet

Passport3 est la troisième génération du portail des membres du Liège Hackerspace.

Le nom reflète sa vocation : offrir aux membres une identité unique et un point d'entrée vers l'écosystème du hackerspace.
