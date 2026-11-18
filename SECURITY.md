# Security Policy

## Supported Versions

The supported line is the default branch. `package.json` is `1.0.0-beta.1`. The git tag
`v1.0.0-beta.1` is a published prerelease at `9b1e08cf9a8cf381b640d26c26277e2b0c5ad169`. It is not a
stable `1.0.0`.

Published prerelease tags, including `v1.0.0-beta.1` and any later prerelease, do not receive
security backports. The supported upgrade path is to pull the default branch and then move to the
next published tag when one exists. Historical tags are unsupported.

`v0.1.0-alpha.0` was published from an earlier repository, and so was a `v1.0.0` release that was
withdrawn on the day it was published, 14 November 2026. The changelog also has an older `1.0.0`
heading dated 1 January 2024, which was a placeholder. None of those is a supported version of this
repository. Local notes for `0.1.0-alpha.1` through `0.1.0-alpha.3` were prepared here and were not
published as GitHub releases.

Security fixes land on the default branch. There is no commitment to backport fixes onto older tags.

| Version                               | Supported                             |
| ------------------------------------- | ------------------------------------- |
| `main`                                | Security fixes land here. Prerelease. |
| `v1.0.0-beta.1` tag                   | Published snapshot. No backports.     |
| `v0.1.0-alpha.0`                      | Not supported                         |
| `v1.0.0` (withdrawn 14 November 2026) | Not supported                         |
| Anything older                        | Not supported                         |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability, please follow
these steps:

### 1. **Do NOT** open a public GitHub issue

- Security vulnerabilities should be reported privately to prevent exploitation

### 2. Report privately

- Message us on Nostr at `npub1ckqlguq0htvs3smwy8pl5uwmfas0h208p7p8hs92ghaurgkmzzrsw3vlh0`, or open
  a
  [private GitHub security advisory](https://github.com/smartflowsocial/smartflowsocial/security/advisories/new)
- Include:
  - Description of the vulnerability
  - Steps to reproduce
  - Potential impact
  - Suggested fix (if any)

### 3. Response timeline

This is a single-maintainer public-domain project. There is no paid support desk and no guaranteed
clock.

- **Initial response**: best effort, usually within a few days
- **Status update**: when there is something new to say
- **Resolution**: depends on severity, and on whether a fix can ship without a history rewrite or a
  production change that needs the owner's approval

### 4. Disclosure policy

- We will work with you to resolve the issue before public disclosure
- We will credit you in the security advisory (if desired)
- We will coordinate disclosure timing with you

## Security Best Practices

When using SmartFlowSocial:

1. **Keep dependencies updated**: Run `pnpm audit` regularly
2. **Use strong secrets**: Generate strong `SESSION_SECRET` values
3. **Enable HTTPS**: Always use HTTPS in production
4. **Review permissions**: Limit database user permissions
5. **Monitor logs**: Regularly review application logs for suspicious activity

## Known Security Features

SmartFlowSocial includes the following security features:

- ✅ CSRF protection
- ✅ XSS protection
- ✅ Content Security Policy (CSP)
- ✅ Secure headers (HSTS, X-Frame-Options, etc.)
- ✅ Rate limiting
- ✅ Input validation and sanitization
- ✅ SQL injection prevention (via Prisma)
- ✅ Secure session management

For more details, see [Security Guide](./docs/guides/security.md).

## Security Updates

Security updates ship on the default branch and, when tagged, as the next alpha or patch.

Operator checklist: [Production security checklist](./docs/guides/production-security-checklist.md).

Dependency decisions: [Dependency advisories](./docs/security/dependency-advisories.md).

---

**Thank you for helping keep SmartFlowSocial secure!**
