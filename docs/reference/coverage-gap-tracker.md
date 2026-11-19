# Coverage Gap Tracker

Source: `coverage/coverage-summary.json` from `pnpm test:coverage` on the Vitest 5 include set. Rank
the next gaps with `pnpm test:coverage:gaps`.

Measured on this branch with `pnpm test:coverage` against a disposable Postgres:

- Lines: `87.00` (21058/24203)
- Branches: `81.80` (18127/22160)
- Functions: `84.95` (3816/4492)
- Statements: `86.16` (22293/25872)

269 files are still under 80% on lines or branches. Autosave, poll handling, and the long-form
loader are no longer in the largest gaps. The largest remaining uncovered-branch files:

| File                                                                   | Uncovered branches | Line % | Branch % |
| ---------------------------------------------------------------------- | -----------------: | -----: | -------: |
| `app/features/posts/utils/thread-list-grouping.ts`                     |                 51 |   73.9 |     48.5 |
| `app/features/public-stats/avatar.server.ts`                           |                 48 |    0.0 |      0.0 |
| `app/features/posts/composer/use-cases/create-post.use-case.server.ts` |                 46 |   75.0 |     57.8 |
| `app/lib/nostr-adapter.client.ts`                                      |                 45 |   77.3 |     63.4 |
| `app/infra/publishers/internal-nostr-publisher.server.ts`              |                 40 |   85.8 |     65.5 |
| `app/features/templates/services/templates-duplicate.server.ts`        |                 39 |    0.0 |      0.0 |
| `app/features/posts/composer/services/newpost-loader.server.ts`        |                 37 |   69.8 |     57.0 |
| `app/features/auth/signer/remote-signer-status.client.ts`              |                 35 |   73.7 |     46.1 |
| `app/features/auth/signer/primary-signer-failover.client.ts`           |                 34 |   63.8 |     39.3 |
| `app/features/auth/reconnect/useReconnectVisibilityEffect.client.ts`   |                 31 |   40.4 |     16.2 |

The Vitest thresholds in `vitest.config.ts` are lines 80, statements 80, functions 78, and
branches 75. The `app/**/*.client.ts` override stays at 70/60. This run cleared those floors.
