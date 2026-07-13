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
- authenticated Payload users or an optional machine bearer secret;
- no dependency on third-party social-feed plugins.

## Payload registration

```ts
import { buildConfig } from 'payload'
import { githubFeedPlugin } from '@dss-feeds/github-feed/payload'

export default buildConfig({
  plugins: [
    githubFeedPlugin(),
  ],
})
```

The plugin registers:

```text
dss-github-feed-settings
dss-github-feed-cache
dss-github-feed-sync
POST /api/dss-github-feed/sync
```

## Protected manual synchronization

An authenticated Payload admin session can queue a forced
synchronization:

```ts
await fetch('/api/dss-github-feed/sync', {
  method: 'POST',
})
```

Machine-to-machine calls can use an optional environment secret:

```env
DSS_GITHUB_FEED_SYNC_SECRET=replace-with-a-long-random-secret
```

```bash
curl -X POST \
  -H "Authorization: Bearer $DSS_GITHUB_FEED_SYNC_SECRET" \
  https://example.com/api/dss-github-feed/sync
```

The endpoint only queues the task and returns `202 Accepted`. It does
not contact GitHub inside the HTTP request.

## Worker

```bash
pnpm payload jobs:run \
  --cron "* * * * *" \
  --queue dss-github-feed \
  --handle-schedules
```
