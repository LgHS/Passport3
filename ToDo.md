# ToDo — Passport

Liste des chantiers prévus pour Passport, par priorité. Une case cochée = fait.
Pour proposer un sujet ou en discuter, ouvre une issue ou une PR.

## 🔴 Critique

- [ ] **Système financier** — remplacement de Dolibarr ([brouillon #98](https://github.com/LgHS/Passport3/pull/98), autre contributeur)
- [ ] **Centraliser le motif lire-fusionner-écrire** des attributs Authentik (dette)

## 🟠 Haute

- [ ] **Onboarding** — parcours de première connexion ([brouillon #129](https://github.com/LgHS/Passport3/pull/129)). Reste : menu grisé, tests
- [ ] **ROI** — versions et ré-acceptation. En attente : règle pour les mises à jour mineures, dépôt du ROI en sous-module
- [ ] **Configuration d'Authentik** pour l'onboarding et les mises à jour du ROI
- [ ] **Demande de contact d'urgence d'un autre membre** — en réflexion
- [ ] **API pour les lecteurs RFID**
- [ ] **Migration du proxy Nuki en web** — peut-être un worker local au hackerspace plutôt que Passport, si Passport est hébergé à l'extérieur
- [ ] **Découper `authentikAdmin.ts`** (dette, après le motif lire-fusionner-écrire)
- [ ] **`prettier --check` en CI** (dette)
- [ ] **Validation des variables d'environnement au démarrage** (dette)

## 🟡 Moyenne

- [ ] **Autorisations d'accès** — un groupe Authentik par porte, machine… ([brouillon #113](https://github.com/LgHS/Passport3/pull/113))
- [ ] **Historique de badging via Nuki**
- [ ] **Choix de licence** BSL 1.1 + CLA ([brouillon #78](https://github.com/LgHS/Passport3/pull/78))
- [ ] **Compétences et machines** sur le trombinoscope — en réflexion
- [ ] **Incidents : notification Mattermost** dans un canal admin, pour réagir vite
- [ ] **Historique des paiements** — lié à la refonte compta et au retrait de Dolibarr
- [ ] **Notification Mattermost des actions auditées** — selon les préférences de notification
- [ ] **Agenda et ouverture du space** — remplace le Google Calendar et pilote la SpaceAPI
  - [ ] Créneaux et page Agenda : ouvertures membres (groupe 24/7), ouvertures publiques et événements (groupe dédié), créneaux des assos, fermetures exceptionnelles, répétitions
  - [ ] Flux public `/agenda.ics`, repris par `lghs.be/calendar.php`
  - [ ] État `/api/space/state` lu par la SpaceAPI (avec repli sur ses horaires), boutons « J'ouvre / Je ferme »
  - [ ] Annonces Mattermost des ouvertures et événements
  - [ ] Import unique des événements du Google Calendar
- [ ] **Liste des courses**
- [ ] **Gestion de team via Authentik** — mécanisme à trouver
- [ ] **Numérisation progressive de l'ardoise**
- [ ] **Gestion du stock** — liée à l'ardoise
- [ ] **Filtres par module sur l'audit**
- [ ] **Impression d'étiquettes** via le réseau ou un Pi
- [ ] **Export RGPD**

## 🟢 Basse

- [ ] **Préférences de notification**, choix par motif
- [ ] **Récap hebdo : section « sans participant »** — comportement à déterminer
- [ ] **API pour d'autres services du hackerspace** — liée à l'API des lecteurs RFID
- [ ] **Changelog** — un lien vers les releases GitHub suffira
- [ ] **Vote sur une date** (mini Doodle) — à croiser avec l'agenda

## ⚪ Très basse

- [ ] **Comptes Authentik au-delà de 500** — on a largement le temps
- [ ] **Marqueur admin dans le menu** — la section « Admin » suffit peut-être
- [ ] **Qui est là**
- [ ] **Repli du menu sur desktop** — à réfléchir, ne pas retirer sans en parler
- [ ] **Réservation des anciens usernames après renommage** — pertinent ?
- [ ] **Voir les caméras des machines**, quand il y en aura
- [ ] **Retrait GitHub à la suppression d'un membre** — mécanisme à déterminer, la suppression se fait dans Authentik
- [ ] **Journalisation structurée des appels sortants** (dette)
