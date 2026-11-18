# Retained-record purge

The worker process deletes retained financial rows itself. It does not call
`GET /cron/purge-retained-records`.

`worker.ts` schedules `purgeRetainedRecords()` about three minutes after the worker starts, then
every `FINANCIAL_RECORD_PURGE_INTERVAL_HOURS` hours. The default is 24. `0` disables that timer. A
run that is already in progress is left alone until it finishes.

The HTTP route is a separate trigger for an external scheduler.

- `POST /cron/purge-retained-records` is the route to keep.
- `GET` still runs the same purge when `X-Cron-Secret` matches. The response sets
  `Deprecation: true`. Leave GET in place until every external scheduler has been changed to POST
  and observed.
- `PUT` and any other method return 405 and do not purge.
- A missing or wrong secret returns 401 and does not purge.

## Move an external scheduler to POST

1. Confirm the worker is the scheduler you intend to keep, or name the external job that still sends
   GET.
2. Change that job to POST. Send the same `X-Cron-Secret` or `Authorization: Bearer` value. Do not
   log the secret.
3. Watch one successful POST. The JSON body matches the GET body.
4. Remove the GET job only after that POST has been observed.
5. Do not delete the GET route in the same change. A scheduler that was not updated would stop
   purging.
