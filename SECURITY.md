
# Security Policy

## Supported versions

Security fixes are applied to the latest version of
the main branch.

## Reporting vulnerabilities

Please do not open public GitHub issues for security
vulnerabilities.

Instead, use GitHub's private vulnerability reporting
feature for this repository, if enabled.

Repository maintainers should enable private reporting
under:

Settings > Security > Code security

If private vulnerability reporting is unavailable,
contact the maintainer privately through an established
contact method.

Please include:
- Description of the vulnerability
- Affected components
- Steps to reproduce
- Potential impact
- Suggested mitigation, if known

Do not submit real user data or publicly disclose
sensitive exploitation details.

## Security architecture

The application uses:
- Cloudflare Access for moderator authentication
- A server-side moderator allowlist
- Cloudflare Turnstile for anonymous submissions
- Cloudflare rate limiting
- D1 database-backed moderation
- Server-side publication controls

Frontend controls are never treated as authentication.

## Production safety

Public submissions may be disabled independently
of the public website and moderation dashboard.

Production secrets must never be committed to Git.

## Disclosure

Maintainers will investigate reported vulnerabilities
and coordinate remediation before public disclosure.
