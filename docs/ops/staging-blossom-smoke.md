# Staging Blossom smoke

`GET /ready` returning 200 means the process can see its database and storage API. It does not prove
that an upload, a read, a hash check, a delete, or a failed commit works.

Do not run this against production. Do not use the production R2 bucket. Use a staging host and a
staging bucket. If the only credentials available are production credentials, stop.

This checklist is not a substitute for a token. The authoritative upload lane needs
`X-SFS-Upload-Token` from an application that is pointed at the staging Blossom server.

## Before the upload

1. Confirm the base URL is the staging server, not `https://blossom-api.smartflow.social`.
2. `curl -sS -D - "$STAGING_BLOSSOM_URL/ready"`. Record the HTTP status. A 200 with
   `checks.storage: true` is readiness only.
3. Use a disposable image under 1 MB. Record its SHA-256 before upload.

## Upload, read, delete

1. Upload through the app's staging media flow, or `PUT /upload` with a staging upload token. Save
   `url` and `sha256` from the response.
2. The response `sha256` must equal the hash recorded before upload.
3. `GET` the returned URL. The body hash must equal that same SHA-256.
4. `HEAD /:key` on the staging server returns 200.
5. Delete with the owner's Blossom auth (`t=delete`) or `DELETE /internal/blob/:key` with the
   staging `x-internal-secret`.
6. `HEAD` the same key and expect 404.
7. Repeat the delete. The second delete must not remove a different object.

## Failed commit

1. Upload once with a token whose expected hash does not match the bytes.
2. Expect the upload to be rejected.
3. Confirm the staging bucket has no new committed object for that hash.
4. Do not retry the rejected body against production.

## Stop

If any step needs a production URL, a production token, or the production bucket, stop and record
the step as not run.
