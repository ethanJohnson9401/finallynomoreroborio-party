# FINALLY NO MORE ROBORIO.

**The retirement party that legacy FRC hardware never asked for.**

The roboRIO has served FIRST Robotics Competition teams for years. Through robot disconnects, late-night deploys, mysterious status lights, and approximately ten million power cycles, it has given us memories we'd rather forget.

Now we're celebrating the next generation of FRC robot controllers with a ridiculously overproduced retirement party.

**[Visit the website](https://finallynomoreroborio.party)**

## What is this?

Finally No More roboRIO is an open-source, unofficial FRC parody website featuring:

- A dramatic retirement celebration for the roboRIO.
- A countdown to the 2027 FRC kickoff.
- An anonymous roboRIO Trauma Center where teams can submit their experiences.
- A moderated public Incident Memorial.
- A private moderation dashboard.
- An unreasonable number of robotics programming jokes.

Built by FRC enthusiasts, for FRC enthusiasts.

## Technology

| Component | Technology |
|---|---|
| Public website | Next.js, React, TypeScript, Tailwind CSS |
| Public API | Cloudflare Workers |
| Database | Cloudflare D1 |
| Human verification | Cloudflare Turnstile |
| Moderation dashboard | Next.js, React, TypeScript |
| Moderator authentication | Cloudflare Access |
| Automated testing | Vitest, GitHub Actions |
| Hosting | Cloudflare Workers and static assets |

## Project structure

```text
finallynomoreroborio-party/
├── src/                  Public website
├── public/               Public assets
├── worker/               Public API and D1 migrations
├── admin-worker/         Protected moderation API
├── admin-dashboard/      Moderation dashboard
├── website-worker/       Public website deployment
├── dashboard-worker/     Admin dashboard deployment
└── .github/workflows/    Automated CI
```

## Local development

**Requirements:** Node.js 24 and npm.

Clone the repository:

```bash
git clone https://github.com/ethanJohnson9401/finallynomoreroborio-party.git
cd finallynomoreroborio-party
```

Install dependencies for the public website:

```bash
npm ci
npm run dev
```

The frontend runs at `http://localhost:3000`.

The public API, admin API, and dashboard are separate projects with their own dependencies and development configurations. Cloudflare Workers and D1 require additional local setup.

Never commit `.env.local`, `.dev.vars`, production API tokens, Turnstile secrets, or moderator credentials.

## Testing

Run the public website checks:

```bash
npm run lint
npm run build
```

Test the public API:

```bash
cd worker
npm ci
npm test -- --run
npm run typecheck
```

Test the moderation API:

```bash
cd admin-worker
npm ci
npm test -- --run
npx tsc --noEmit
```

GitHub Actions automatically validates the website, APIs, and admin dashboard on pushes and pull requests.

## Submitting incidents

The roboRIO Trauma Center allows anonymous incident submissions when intake is enabled.

Reports are validated, rate-limited, verified using Cloudflare Turnstile, and stored as pending moderation.

**Incidents are never automatically published.** A moderator must approve each report before it appears on the public Memorial Wall.

Please do not submit personal information, private contact details, credentials, or identifying information about other people.

## Privacy and content moderation

Incident submissions are anonymous and require moderator
approval before publication.

Do not submit personal information, identifying details,
or private contact information.

Read our [Privacy and Content Policy](PRIVACY.md) for
information about submissions, moderation, data handling,
and removal requests.

## Contributing

Contributions, bug reports, performance improvements, accessibility fixes, and sufficiently ridiculous roboRIO jokes are welcome.

Please open an issue before starting major architectural changes.

## Disclaimer

This is an unofficial community parody project.

It is not affiliated with, endorsed by, or operated by FIRST, National Instruments, or any other FRC hardware manufacturer.

All trademarks and product names belong to their respective owners.