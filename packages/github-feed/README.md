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

The cache collection is hidden from normal admin navigation. Runtime writes
will be performed only by the package's trusted Payload job through the Local
API in the next vertical slice.
