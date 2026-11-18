# Staging Blastr queue

Do not create, change, or deploy Cloudflare queues from this checklist. Confirm what is already
there.

`wrangler.toml` in `smartflowsocial-blastr` binds:

- production producer and consumer to `blastr-publish-jobs`
- the staging environment to `blastr-publish-jobs-staging`

A staging worker must not consume `blastr-publish-jobs`.

## Confirm before a staging deploy

1. In the Cloudflare account used for staging, list queues. The staging queue name is
   `blastr-publish-jobs-staging`.
2. The production queue `blastr-publish-jobs` is a different queue.
3. The staging worker's consumer binding is `blastr-publish-jobs-staging`.
4. The staging worker's producer binding is the same staging queue.
5. No staging route, cron, or consumer is attached to `blastr-publish-jobs`.
6. If `blastr-publish-jobs-staging` does not exist, stop. Create it with the owner present:
   `wrangler queues create blastr-publish-jobs-staging`. Do not create it from an unattended run,
   and do not deploy staging until it exists.

Checked-in `wrangler.toml` does not contain Cloudflare resource ids. Seeing the queue name in git is
not proof the queue exists in the account.
