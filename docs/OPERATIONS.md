# Production Operations Manual

**finallynomoreroborio.party — roboRIO Trauma Center**

Maintained for the unofficial, open-source FRC parody project.

## 1. Production architecture

The platform uses four Cloudflare Workers:

| Component | Production URL | Source |
|---|---|---|
| Public website | https://finallynomoreroborio.party | `src/` and `website-worker/` |
| Public API | https://api.finallynomoreroborio.party | `worker/` |
| Admin dashboard | https://admin.finallynomoreroborio.party | `admin-dashboard/` and `dashboard-worker/` |
| Admin API | https://admin-api.finallynomoreroborio.party | `admin-worker/` |

Both APIs use the same Cloudflare D1 database, `roborio-trauma-db`.

Production database ID: `276e3d2b-dee8-40b0-a5b0-585231effff3`.

The public API accepts incident submissions when explicitly enabled. Every submission starts as pending. Approved reports are displayed on the public Memorial Wall.

The admin dashboard and Admin API must remain protected by Cloudflare Access. The Admin API additionally verifies the moderator identity against the `MODERATOR_EMAILS` secret.

## 2. Production safety switches

### Public incident submissions

File: `worker/wrangler.jsonc`

Under `env.production.vars`:

```json
"ENABLE_INCIDENT_SUBMISSIONS": "false",
"TURNSTILE_TEST_MODE": "false"
```

Keep these values for normal prelaunch operation.

To open submissions, change only `ENABLE_INCIDENT_SUBMISSIONS` to `"true"` and redeploy the public API.

Production submission authorization additionally requires the correct deployment environment and real Turnstile secret.

**Never enable Turnstile testing credentials in production.**

### Admin moderation

File: `admin-worker/wrangler.jsonc`

```json
"ADMIN_API_ENABLED": "true",
"ADMIN_QUEUE_ENABLED": "true"
```

`ADMIN_API_ENABLED` controls review mutations.

`ADMIN_QUEUE_ENABLED` controls retrieval of the pending moderation queue.

The production admin dashboard also requires the build-time configuration:

```text
NEXT_PUBLIC_MODERATION_WRITES_ENABLED=true
```

This frontend setting is not authorization. Server-side checks remain mandatory.

## 3. Secrets and configuration

Important configuration values include:

| Name | Component | Purpose |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Public API | Server-side verification |
| `TURNSTILE_TEST_MODE` | Public API | Restricts testing behavior |
| `ENABLE_INCIDENT_SUBMISSIONS` | Public API | Intake switch |
| `MODERATOR_EMAILS` | Admin API | Verified moderator allowlist |
| `ADMIN_API_ENABLED` | Admin API | Review mutation switch |
| `ADMIN_QUEUE_ENABLED` | Admin API | Queue availability |
| `NEXT_PUBLIC_API_URL` | Website | Public API address |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Website | Public Turnstile site key |
| `NEXT_PUBLIC_MODERATION_WRITES_ENABLED` | Dashboard | Review control display |

Never commit real secret values, `.dev.vars`, `.env.local`, exported database records, or Cloudflare API tokens.

Store secrets using Cloudflare's secret management tools and restrict production access.

## 4. Local validation

From the repository root:

### Public website

```bash
npm ci
npm run lint
npm run build
```

### Public API

```bash
cd worker
npm ci
npm run typecheck
npm test -- --run
cd ..
```

### Admin API

```bash
cd admin-worker
npm ci
npx tsc --noEmit
npm test -- --run
cd ..
```

### Admin dashboard

```bash
cd admin-dashboard
npm ci
npm run build
cd ..
```

All checks should pass before production deployment.

GitHub Actions also runs automated checks for the four application components. CI does not deploy production Workers.

## 5. Production deployment

Run deployment commands from the appropriate package directories.

### Public website

```bash
npm run build
cd website-worker
npx wrangler deploy --env production
cd ..
```

### Public API

```bash
cd worker
npx wrangler deploy --env production
cd ..
```

### Admin dashboard

```bash
cd admin-dashboard
npm run build
cd ../dashboard-worker
npx wrangler deploy --env production
cd ..
```

### Admin API

```bash
cd admin-worker
npx wrangler deploy --env production
cd ..
```

Check deployment output for the correct Worker name, custom domain, and environment variable values.

When changing an API response consumed by a frontend, deploy the compatible API version first.

## 6. Database backups

Before changing production database schema or performing destructive maintenance, export the database.

From `worker/`:

```bash
mkdir -p ../private-backups
```

```bash
npx wrangler d1 export roborio-trauma-db --remote --output=../private-backups/roborio-trauma-backup.sql
```

This exports schema and data to a local SQL file.

**The backup may contain user-submitted reports and moderator audit information. Treat it as private data.**

Do not commit it to GitHub. Store backups securely and limit access.

To inspect record counts without modifying data:

```bash
npx wrangler d1 execute roborio-trauma-db --remote --command "SELECT status, COUNT(*) AS total FROM incidents GROUP BY status;"
```

Before restoring any backup, first verify the target database, take another backup of its current state, and check schema compatibility. Never blindly import an old full-database export into a live populated database.

## 7. Database migrations

Migrations are maintained under `worker/migrations/`, with related migrations also present under `admin-worker/migrations/`.

Use the public Worker migration directory as the canonical migration source to avoid conflicting migration histories.

From `worker/`:

```bash
npx wrangler d1 migrations list roborio-trauma-db --remote
```

After reviewing new migrations and backing up production:

```bash
npx wrangler d1 migrations apply roborio-trauma-db --remote
```

Never run unreviewed destructive SQL against production.

Cloudflare migrations do not automatically guarantee rollback compatibility with older Worker versions.

## 8. Emergency procedures

### Close public intake

Set:

```json
"ENABLE_INCIDENT_SUBMISSIONS": "false"
```

in the production public API configuration.

Deploy:

```bash
cd worker
npx wrangler deploy --env production
```

Verify:

```bash
curl -s https://api.finallynomoreroborio.party/api/incidents/config
```

Expected:

```json
{"submissionsEnabled":false}
```

The public website will recognize the closed intake state on its next status request.

### Disable moderation writes

If moderation must be temporarily stopped, change:

```json
"ADMIN_API_ENABLED": "false"
```

in the Admin API's production configuration, then redeploy `admin-worker/`.

This is a server-side emergency control. Merely hiding dashboard buttons is insufficient.

### Access incident

If unauthorized admin access is suspected, immediately review and restrict the Cloudflare Access applications for both admin domains, investigate session and access logs, and rotate any credentials that may have been exposed.

Changing the frontend does not protect the Admin API.

## 9. Production verification

### Public API health

```bash
curl -s https://api.finallynomoreroborio.party/api/health
```

### Intake availability

```bash
curl -s https://api.finallynomoreroborio.party/api/incidents/config
```

### Published incidents

```bash
curl -s https://api.finallynomoreroborio.party/api/incidents/approved
```

When no incidents are published, expect an empty incidents array.

### Admin dashboard

Open:

https://admin.finallynomoreroborio.party

Verify that:

- Cloudflare Access requires the intended authentication.
- The dashboard displays `ONLINE`.
- Pending counts and queue retrieval work.
- Only approved moderators can perform reviews.
- Approval/rejection requires confirmation.
- Reviewed reports are removed from the pending queue.

Do not use real community reports to test destructive review actions.

## 10. Rollback

Cloudflare Workers supports reverting to a previously deployed Worker version.

From the affected Worker's directory, inspect deployments:

```bash
npx wrangler deployments list --env production
```

For a confirmed compatible rollback target, use the Cloudflare dashboard's deployment history or Wrangler's rollback command.

**Caution:** Rolling back a Worker does not restore or reverse D1 database changes. Check database schema compatibility first.

Static frontend deployments may also depend on API versions and build-time configuration.

## 11. Launch checklist

Before opening submissions:

- [ ] GitHub Actions CI passes.
- [ ] Public website and both APIs respond correctly.
- [ ] Admin dashboard remains protected by Cloudflare Access.
- [ ] Turnstile uses real production credentials.
- [ ] Production rate limiting is configured.
- [ ] Moderation queue loads and pagination works.
- [ ] Approved reports appear publicly; pending/rejected reports do not.
- [ ] D1 database backup has been created and stored securely.
- [ ] Privacy and acceptable-content guidance has been reviewed.
- [ ] Emergency submission shutdown has been rehearsed.
- [ ] Public intake is deliberately enabled only when moderators are ready.

## 12. Official documentation

- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/
- Cloudflare Turnstile: https://developers.cloudflare.com/turnstile/
- GitHub Actions: https://docs.github.com/actions

---

**Remember:** The roboRIO may have retired, but production incidents do not resolve themselves.
