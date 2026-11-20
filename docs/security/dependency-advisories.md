# Dependency advisories

Refreshed on 20 November 2026 against `pnpm-lock.yaml` with pnpm 12.21.0.

## effect in Prisma config

`pnpm audit --prod --audit-level high` failed on `develop` at
`907c3bc3f161480dfab2826e2da7923d18296dcc` for
[GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw). The locked path was
`prisma@7.10.1` → `@prisma/config@7.10.1` → `effect@3.20.0`. The advisory covers `effect` through
`3.22.0`. `3.22.1` changes `Schema.TemplateLiteral` matching for templates made only of
`Schema.String` spans so a non-matching input does not backtrack.

`prisma@7.10.1` is the newest Prisma 7 release, and every `@prisma/config` 7.x release still depends
on `effect@3.20.0` exactly. Prisma 8.0.0 is a release candidate (`latest` on npm is `8.0.0-rc.34`)
and was not adopted. `pnpm-workspace.yaml` overrides `@prisma/config>effect` to `3.22.1`, which
stays on effect 3.x. Remove the override when a Prisma 7 config package depends on `effect` 3.22.1
or newer.

`@prisma/config` loads the Prisma CLI configuration. This application does not import `effect`, and
it does not decode request bodies with `Schema.TemplateLiteral`. The vulnerable function is not on
the request path. The override still removes `effect@3.20.0` from the production install because
`prisma` is a production dependency.

## Earlier note, 16 November 2026

The note below was taken with pnpm 10.27.0. It is not the current audit.

The application is React 19.2.7 and React Router 8.5.1. The React Router 6.30.6 advisories in the 15
November note are not in this graph. `pnpm audit --prod` reported no advisories. High and critical
findings: none.

## Production

`pnpm audit --prod` on 16 November 2026: no known vulnerabilities.

`@sentry/bundler-plugins` pulls `minimatch` 11.0.8. That version is outside
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), which covers
`>=7.0.0 <11.0.1`.

## Development

`pnpm audit` reports one moderate finding:

| Package     | Installed | Advisory                                                                 | Where                                     | Decision                                                                                                                                                                                                                                                                                           |
| ----------- | --------- | ------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimatch` | 10.2.6    | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | `@react-router/fs-routes` 8.5.1, dev only | Leave it. The patched line is 11.0.1 or newer. Forcing that major onto the React Router route scanner can change route discovery. The finding is a glob denial of service in a development tool, not a request path in the running server. ESLint's `minimatch` 3.1.5 is below the affected range. |

Do not treat a clean production audit as a promise about companion repositories. Publisher, Blastr,
Blossom, and the cache worker were not re-audited in this pass. Their earlier notes are below and
are dated 14 November 2026.

## Publisher, production

`valibot` 1.2.0 had a moderate advisory: `record()` issue paths can make `flatten()` throw when a
property name is inherited. The publisher schemas use `object`, `array`, and `pipe`, not
`record().flatten()`. It is now on 1.5.0. `pnpm audit --prod` in the publisher reported no known
vulnerabilities on 14 November 2026.

The rest of the publisher audit is the Wrangler and Vitest development tree. Those packages are not
in the worker bundle. Do not treat that list as production exposure.

## Blastr, Blossom, cache worker

`pnpm audit --prod` reported no advisories in Blastr, Blossom, or the cache worker on 14
November 2026. Their full audits report the same class of development-tool findings as the
publisher. Those trees were not opened in this pass.

## What this does not do

The web app is React Router 8.5.1 and React 19.2.7. Remix packages are gone except
`@remix-run/form-data-parser`, which parses multipart uploads.
