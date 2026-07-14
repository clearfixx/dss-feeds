# @dss-feeds/github-feed

An owned, cache-first GitHub commit feed integration for Payload CMS
and React.

The package is private while its API and production integration are
validated.

## Guarantees

- no GitHub request during page rendering;
- no injected attribution, branding, analytics, or hidden backlinks;
- no visitor-facing provider errors;
- stale local snapshots remain available when synchronization fails;
- neutral optional CSS and a replaceable item renderer;
- Payload Admin monitor reads only local cache and job documents.

## Payload registration

```ts
import { buildConfig } from 'payload'
import {
  githubFeedPlugin,
} from '@dss-feeds/github-feed/payload'

export default buildConfig({
  plugins: [
    githubFeedPlugin(),
  ],
})
```

The settings Global includes an operational monitor with:

- cache state and commit count;
- last generation and next synchronization timestamps;
- recent Payload job attempts;
- structured synchronization events;
- `Refresh status`;
- `Regenerate cache`.

The regenerate action queues a forced Payload task through the protected
endpoint. It does not contact GitHub from the browser.

## Pure presentation component

```tsx
import {
  DSSGitHubFeed,
} from '@dss-feeds/github-feed'
import '@dss-feeds/github-feed/styles.css'

<DSSGitHubFeed
  commits={cachedCommits}
  commitCount={3}
  order="desc"
  heading="// GitHub activity"
  profileUrl="https://github.com/your-account"
/>
```

## Payload server component

```tsx
import {
  DSSGitHubFeedServer,
} from '@dss-feeds/github-feed/payload'
import '@dss-feeds/github-feed/styles.css'

<DSSGitHubFeedServer
  payload={payload}
  commitCount={3}
  order="desc"
  heading="// GitHub activity"
  profileUrl="https://github.com/your-account"
/>
```

## Worker

```bash
pnpm payload jobs:run \
  --cron "* * * * *" \
  --queue dss-github-feed \
  --handle-schedules
```
## Persistent live monitor

Synchronization history is stored in hidden fields of the settings Global, not
only in temporary `payload-jobs` documents. The monitor therefore keeps the
latest status, duration, attempt count, error, cache metadata, and 20 structured
events after Payload removes a completed job.

`Refresh status` reads the authenticated Payload Global endpoint without a page
reload. After `Regenerate cache`, the monitor polls that local endpoint until a
new run reaches `success`, `skipped`, or `error`. The browser never contacts
GitHub directly.
