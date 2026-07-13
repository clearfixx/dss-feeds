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
- provider errors that do not expose credentials;
- Payload plugin registration;
- authenticated settings global;
- internal snapshot collection with denied external writes;
- synchronization service with one-document snapshot replacement;
- deterministic SHA-256 content checksum;
- fresh, stale, and next-sync timestamps;
- failed provider requests leave the previous snapshot untouched;
- scheduled Payload task with three retries;
- exclusive concurrency with pending-job superseding;
- hourly schedule checks with settings-controlled due times;
- structured synchronization events stored in successful task output;
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
```

## Worker

The recurring schedule queues a job every hour. A dedicated worker should
handle schedules and execute jobs from the same queue:

```bash
pnpm payload jobs:run \
  --cron "* * * * *" \
  --queue dss-github-feed \
  --handle-schedules
```

The hourly task is only a due-time check. If the settings specify a longer
synchronization interval and `nextSyncAt` is still in the future, the task
exits without contacting GitHub.

## Manual server-side synchronization

```ts
import { synchronizeGitHubFeed } from '@dss-feeds/github-feed/payload'

await synchronizeGitHubFeed({
  payload,
  token: process.env.DSS_GITHUB_TOKEN,
  force: true,
})
```

A failed request never clears the last successful snapshot.
