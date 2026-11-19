# Deployment mode

`SFS_DEPLOYMENT_MODE` decides whether this process is an operator install or the managed
SmartFlowSocial service.

| Value         | Commercial policy                                                           |
| ------------- | --------------------------------------------------------------------------- |
| `self_hosted` | No platform commission. No hosted plan cap unless the operator sets one.    |
| `hosted`      | Free 10%, Starter 7.5%, Creator 5%, Pro/Teams/Founder 0%. Plan limits stay. |

`SELF_HOSTED=true` still means `self_hosted`. `SELF_HOSTED=false` still means `hosted`. If both
variables are set, they must name the same mode. A cookie or a request cannot change it.

## Defaults

A development or test process with neither variable set is self-hosted. The publisher and the reader
are `internal` unless `NOSTR_PUBLISHER_BACKEND=http` or `NOSTR_READ_BACKEND=legacy_http` is set. An
empty mode does not charge a platform commission.

`NODE_ENV=production` without a mode refuses to start. The same refusal applies when `APP_URL` or
`COOLIFY_URL` is `https://app.smartflow.social` or `https://staging.smartflow.social`. The error
names `SFS_DEPLOYMENT_MODE`.

## Hosted production and staging

Set this before deploying a build that contains this check. The previous image ignores the variable,
so the running service does not change when the variable is added.

```text
SFS_DEPLOYMENT_MODE=hosted
NOSTR_PUBLISHER_BACKEND=internal
NOSTR_READ_BACKEND=internal
```

Remove an HTTP `NOSTR_PUBLISHER_URL` unless the backend is explicitly `http`. Remove an HTTP
`PRIMAL_CACHING_URL` unless the reader is explicitly `legacy_http`. Web and worker need the same
values.

Observed on 19 November 2026, before this change, both https://app.smartflow.social and
https://staging.smartflow.social reported `publisherBackend=internal`, `nostrReadBackend=internal`,
deployment mode `hosted`, and source commit `f2c608cda877e99712c16b4f8c2946d8e7329bf4`. This
document does not change those Coolify settings. Set `SFS_DEPLOYMENT_MODE=hosted` on both before the
new image rolls out, or the new image will refuse to start if `SELF_HOSTED` is not already `false`.

## Rollback

1. Put the previous image back. It ignores `SFS_DEPLOYMENT_MODE`.
2. Leave `SFS_DEPLOYMENT_MODE=hosted` in place for the managed service. Removing it is not required
   for the old image and makes the next new image fail closed again.
3. To leave the new image running and return to the legacy publisher, set
   `NOSTR_PUBLISHER_BACKEND=http` plus the previous URL and token, then restart web and worker.
   Change the reader separately with `NOSTR_READ_BACKEND=legacy_http` and the previous HTTP cache
   URL.

Do not set the managed service to `self_hosted`. That removes platform commission and hosted plan
limits.
