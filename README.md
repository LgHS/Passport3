# Passport3

Passport3 is the member portal of the [Liège Hackerspace](https://lghs.be).

It provides a single, user-friendly interface for members to manage their identity, membership, subscriptions, access rights, and other information related to the hackerspace.

Passport3 acts as a custom frontend for several internal services, including:

- **Authentik** for authentication and identity management
- **Dolibarr** for memberships, subscriptions, and payments
- **Access control systems** for physical access to the hackerspace
- Additional community and member-management services

## Goals

Passport3 aims to provide members with one central place to:

- [x] View and update their personal information
- [x] Check their membership status
- [x] View current and previous subscriptions
- [ ] Access payment and accounting information
- [ ] Manage authentication and security settings
- [ ] View their physical access permissions
- [ ] Manage badges or access credentials
- [ ] Access the member directory and phonebook
- [ ] Choose which information is visible to other members
- Access future hackerspace services through a unified interface

## Integrations

### Authentik

Authentik is used as the identity provider and authentication backend.

Passport3 provides a custom member-facing interface while relying on Authentik for:

- Authentication
- Single Sign-On
- User identities
- Groups and roles
- Security and session management

### Dolibarr

Dolibarr is used for administrative and financial membership management.

Passport3 communicates with Dolibarr to retrieve or manage:

- Member records
- Membership subscriptions
- Subscription expiration dates
- Payments
- Invoices and supporting documents
- Administrative membership status

### Access Control

Passport3 provides an interface between members and the hackerspace access-control infrastructure.

Depending on the deployed hardware and configuration, it may support:

- Viewing access permissions
- Managing badges or access credentials
- Requesting or activating access
- Viewing credential status
- Revoking lost credentials
- Synchronizing access rights with membership status

## Planned Features

- Member profile management
- Membership and subscription overview
- Online subscription renewal
- Payment history
- Invoice and document downloads
- Badge and access management
- Member directory
- Phonebook
- Profile pictures
- Privacy and visibility settings
- Emergency contact management
- Notification preferences
- Administrative interface
- Audit history
- API for other hackerspace services

## Privacy

Passport3 processes personal data belonging to hackerspace members.

The project follows the principles of:

- Data minimization
- Explicit purpose
- Least-privilege access
- User transparency
- Limited retention
- Secure storage
- Member-controlled visibility

Private member information must never be exposed through the directory or APIs without an explicit authorization rule.

## Preprod deployment

`docker-compose.yml` builds from source (local dev). `docker-compose.preprod.yml` instead pulls
the image built by CI (`.github/workflows/docker-release.yml`) from GHCR and runs Watchtower
alongside it to auto-update whenever a new version is released.

One-time setup on the preprod host:

```bash
# PAT needs the read:packages scope; a machine/bot GitHub account is preferable to a personal one.
echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin

docker compose -f docker-compose.preprod.yml up -d
```

Releasing a new version (`git tag vX.Y.Z && git push --tags`, or `gh release create vX.Y.Z`)
builds and pushes `ghcr.io/lghs/passport3:X.Y.Z` and `ghcr.io/lghs/passport3:preprod` — Watchtower
picks up the `preprod` tag update within 5 minutes and redeploys automatically.

## Contributing

Contributions are welcome.

Passport3 is developed for the Liège Hackerspace community. Issues, suggestions, and pull requests can be submitted through the project repository.

Please do not include personal member data, credentials, API keys, or production configuration in issues or contributions.

## Project Name

Passport3 is the third generation of the Liège Hackerspace member portal.

The name reflects its purpose: providing members with a single identity and entry point to the hackerspace ecosystem.
