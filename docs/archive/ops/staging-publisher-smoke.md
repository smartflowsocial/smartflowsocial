# Staging Publisher smoke

> Archived on 19 November 2026. This note is a historical record of the external publisher Worker.
> Current SmartFlowSocial does not call that Worker and refuses `NOSTR_PUBLISHER_URL`. Do not use
> this procedure for a current install. See
> [Internal Nostr publisher](../../operations/internal-nostr-publisher.md).

Use a staging worker, an ephemeral key, and a relay you control. Do not send a production user's
event. Do not point the request at a public relay.

The staging URL is the value already configured for that environment. Do not copy it from
production. The token is the staging `API_TOKEN`. Send it as `API-TOKEN`. Do not print the token.

## Checks

1. POST `/publish` with no token. Expect 401.
2. POST `/publish` with a wrong token. Expect 401.
3. Build a kind 1 event with an ephemeral key. POST it to one isolated `ws://` or `wss://` relay.
   Expect the worker to accept it and the relay to store that event id.
4. Change one byte of `content` without resigning. POST again. Expect 400. The relay must not store
   the altered event.
5. POST the original valid event to a relay address that is not running. Expect a failed delivery
   and a retryable response. The isolated relay from step 3 must still contain only the first event.
6. POST the same signed event again to the live isolated relay. The relay should keep one copy of
   that event id. A second delivery is not a second note.
7. Confirm the request host was the staging worker, not the production worker.

`pnpm test:worker` in `smartflowsocial-publisher` covers this shape against a local worker and a
loopback relay. A green local run does not prove the deployed staging worker is that commit.
