# Coverage Gap Tracker

Source: `coverage/coverage-summary.json` from `pnpm test:coverage` on the Vitest 5 include set. Rank
the next gaps with `pnpm test:coverage:gaps`.

Measured:

- Lines: `86.57` (20912/24154)
- Branches: `81.27` (17964/22102)
- Functions: `84.84` (3806/4486)
- Statements: `85.76` (22141/25817)

Lines and branches are both above 80. 270 files are still under 80% on lines or branches. The
largest remaining uncovered-branch files:

| File                                                                           | Uncovered branches | Line % | Branch % |
| ------------------------------------------------------------------------------ | -----------------: | -----: | -------: |
| `app/features/posts/utils/thread-list-grouping.ts`                             |                 51 |   73.9 |     48.5 |
| `app/features/posts/composer/services/newpost-action/autosave-draft.server.ts` |                 50 |    0.0 |      0.0 |
| `app/features/public-stats/avatar.server.ts`                                   |                 48 |    0.0 |      0.0 |
| `app/features/posts/composer/services/newpost-action/poll-handlers.server.ts`  |                 47 |    2.2 |      0.0 |
| `app/features/posts/composer/use-cases/create-post.use-case.server.ts`         |                 46 |   75.0 |     57.8 |
| `app/lib/nostr-adapter.client.ts`                                              |                 45 |   77.3 |     63.4 |
| `app/infra/publishers/internal-nostr-publisher.server.ts`                      |                 40 |   85.8 |     65.5 |
| `app/features/templates/services/templates-duplicate.server.ts`                |                 39 |    0.0 |      0.0 |
| `app/features/posts/longform/services/newlongform-loader.server.ts`            |                 38 |   33.3 |     17.4 |
| `app/features/posts/composer/services/newpost-loader.server.ts`                |                 37 |   69.8 |     57.0 |

The Vitest thresholds in `vitest.config.ts` are still the previous floor (lines 52, statements 51,
functions 54, branches 40). The `app/**/*.client.ts` override stays at 70/60.
