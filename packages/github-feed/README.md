# @dss-feeds/github-feed

An owned, cache-first GitHub commit feed integration.

The package is private while its provider client, Payload integration,
cache lifecycle, admin monitor, and neutral React component are validated
in production.

## Current foundation

- native `fetch` GitHub REST client;
- strict repository identifier validation;
- optional bearer-token authentication;
- request timeout and external abort support;
- normalized commit records;
- cross-repository sorting and deduplication;
- Payload settings and internal snapshot collection;
- atomic snapshot synchronization with stale-cache preservation;
- scheduled Payload task with retries and concurrency control;
- protected manual synchronization endpoint;
- server-side cache reader;
- fresh, stale, expired, empty, and unavailable states;
- stale snapshots remain renderable;
- expired and unavailable snapshots expose no visitor-facing error;
- repository filtering, ordering, and display limits;
- no dependency on third-party social-feed plugins.

## Server-side read

```ts
import { readGitHubFeed } from '@dss-feeds/github-feed/payload'

const feed = await readGitHubFeed({
  payload,
  commitCount: 3,
  order: 'desc',
})

if (!feed.renderable) {
  return null
}
```

The reader uses Payload Local API with `overrideAccess: true`. It never
contacts GitHub. Fresh and stale snapshots are renderable; expired,
missing, malformed, or temporarily unavailable cache data fails closed.
