# Deployment mode

`SFS_DEPLOYMENT_MODE` is the only commercial deployment selector.

| Value         | Commercial policy                                                                 |
| ------------- | --------------------------------------------------------------------------------- |
| `self_hosted` | No platform commission. No hosted plan cap unless the operator sets one.          |
| `hosted`      | Free 10%, Starter 7.5%, Creator 5%, Pro, Teams, and Founder 0%. Plan limits stay. |

Unset means `self_hosted`, including `NODE_ENV=production`. A cookie, header, query parameter, or
browser store cannot change it.

`SELF_HOSTED` is not read. A non-empty value refuses to boot.

## Managed hosts

`app.smartflow.social` and `staging.smartflow.social` refuse every mode except `hosted`. The host is
taken from `APP_URL` or `COOLIFY_URL`. That check stops a managed deploy from charging 0% by
accident. It is not how an independent install selects its policy.

Managed production and staging:

```dotenv
SFS_DEPLOYMENT_MODE=hosted
```

Web and worker use the same value. Publishing and Nostr reads run inside both processes. There is no
publisher backend variable and no cache backend variable.

## Independent install

A production build with no mode is self-hosted and charges no platform commission. Do not set
`SFS_DEPLOYMENT_MODE=hosted` on an install you operate unless you intend to charge the hosted rates.

## Rollback

Put the previous image back. Leave `SFS_DEPLOYMENT_MODE=hosted` on the managed service. Do not set
the managed service to `self_hosted`.
