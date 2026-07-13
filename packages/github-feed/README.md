# @dss-feeds/github-feed

An owned, cache-first GitHub commit feed integration for Payload CMS and React.

The package is private while its API and production integration are validated.

## Guarantees

- no GitHub request during page rendering;
- no injected attribution, branding, analytics, or hidden backlinks;
- no visitor-facing provider errors;
- stale local snapshots remain available when synchronization fails;
- neutral optional CSS and a replaceable item renderer.

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

## Pure presentation component

The default component receives normalized local data and performs no I/O:

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

The convenience server component reads only the local Payload cache:

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

When the cache is missing, expired, malformed, or temporarily unavailable, the
component returns `null` unless an explicit `emptyState` is supplied.

## Styling

The stylesheet is intentionally neutral and uses CSS custom properties:

```css
.site-footer .dss-github-feed {
  --dss-github-feed-background: transparent;
  --dss-github-feed-border: rgba(255, 255, 255, 0.14);
  --dss-github-feed-text: #f4f7fb;
  --dss-github-feed-muted: #8b98a7;
  --dss-github-feed-accent: #2de2e6;
  --dss-github-feed-radius: 0.5rem;
}
```

For complete control, omit the default stylesheet or provide `renderItem`.

## Worker

```bash
pnpm payload jobs:run \
  --cron "* * * * *" \
  --queue dss-github-feed \
  --handle-schedules
```
