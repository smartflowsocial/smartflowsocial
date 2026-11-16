# Dependency advisories

Refreshed on 16 November 2026 with pnpm 10.27.0 against `pnpm-lock.yaml`.

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
