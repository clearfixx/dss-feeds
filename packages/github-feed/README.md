# @dss-feeds/github-feed

An owned, cache-first GitHub commit feed integration.

The package is private while its provider client, Payload integration, cache
lifecycle, admin monitor, and neutral React component are validated in
production.

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
- synchronization service with atomic snapshot replacement;
- deterministic SHA-256 content checksum;
- fresh, stale, and next-sync timestamps;
- structured operational log callbacks;
- failed provider requests leave the previous snapshot untouched;
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
```

## Manual server-side synchronization

```ts
import { synchronizeGitHubFeed } from '@dss-feeds/github-feed/payload'

await synchronizeGitHubFeed({
  payload,
  token: process.env.DSS_GITHUB_TOKEN,
})
```

The provider request completes and validates before the active cache document
is created or replaced. A failed request never clears the last successful
snapshot.
