# @dss-feeds/x-feed

Source-agnostic, cache-first foundation for X post feeds.

The package is private while its provider contracts and production integration
are validated.

## Current boundary

The package currently owns:

- normalized X post types;
- strict runtime validation;
- provider/source contracts;
- timeout and abort handling;
- incremental `sinceId` requests;
- reply/repost filtering;
- deterministic deduplication, ordering, and limits;
- an official X API v2 source adapter;
- lightweight Nitter-compatible and RSSHub source adapters;
- deterministic source fallback;
- framework-agnostic snapshot storage, synchronization, and stale-cache reads.

It intentionally does **not** include:

- Payload CMS collections, jobs, or admin UI;
- React presentation components;
- Portfolio-specific markup, class names, or design tokens.

Provider-specific credentials are captured by server-side source adapters and
never become public component props.

## Source contract

```ts
import {
  collectXPosts,
  type XFeedSource,
} from '@dss-feeds/x-feed'

const source: XFeedSource = {
  id: 'my-x-source',
  async fetchPosts({ config, signal, sinceId }) {
    // Fetch and normalize posts using any server-side implementation.
    // Secrets remain inside this adapter.
    return []
  },
}

const posts = await collectXPosts(
  source,
  {
    username: 'your_handle',
    postLimit: 5,
    excludeReplies: true,
    excludeReposts: true,
  },
  { sinceId: '1900000000000000000' },
)
```

`collectXPosts` validates every returned record before it can enter a cache.
An author's numeric X user ID is nullable because lightweight RSS feeds often
do not expose it.

## Source options

| Source | Cost | Credentials | Data quality | Typical use |
| --- | --- | --- | --- | --- |
| Official X API | Pay-per-use | X bearer token | Full fields and metrics | Stable production source |
| Nitter-compatible RSS | No X API credits | Depends on instance | Reduced metadata | Self-hosted lightweight source |
| RSSHub | No X API credits | Depends on instance/route | Reduced metadata | Existing RSSHub deployment |
| Custom `XFeedSource` | Depends on implementation | Custom | Custom | Proxies and private backends |

The RSS adapters do not scrape `x.com` directly. They consume a trusted RSS
endpoint supplied by the application. Self-hosted instances are recommended;
public instances can disappear, rate-limit, or require their own authenticated
sessions.

## Stability metadata

Built-in sources expose operational metadata for admin UIs and monitors:

```ts
import { getXFeedSourceMetadata } from '@dss-feeds/x-feed'

const metadata = getXFeedSourceMetadata(source)

if (metadata.stability === 'experimental') {
  console.warn(metadata.warning)
}
```

The official X API reports `stable`. Nitter-compatible and RSSHub sources report
`experimental` with a warning suitable for a destructive-looking admin label.
Fallback chains report `composite`; custom sources without metadata report
`unknown` rather than being treated as stable.

## Official X API source

```ts
import { collectXPosts } from '@dss-feeds/x-feed'
import { createXApiSource } from '@dss-feeds/x-feed/source/x-api'

const source = createXApiSource({
  bearerToken: process.env.X_BEARER_TOKEN!,
  onResponse(info) {
    console.info(info.endpoint, info.status, info.rateLimit)
  },
})

const posts = await collectXPosts(source, {
  username: 'your_handle',
  postLimit: 5,
})
```

The official adapter:

- resolves a username to a user ID;
- caches that user lookup in memory for one hour by default;
- requests only the post, user, and media fields used by the normalized model;
- applies reply/repost exclusions at the API boundary;
- forwards `sinceId` as `since_id`;
- reports rate-limit headers through an optional callback;
- maps authentication, authorization, not-found, and rate-limit failures to
  structured `XFeedError` codes;
- never logs or returns the bearer token.

## Lightweight RSS sources

### Nitter-compatible

```ts
import { createXRssSource } from '@dss-feeds/x-feed/source/rss'

const source = createXRssSource({
  provider: 'nitter',
  baseUrl: process.env.NITTER_BASE_URL!,
  authorId: process.env.X_USER_ID,
  authorName: 'Your display name',
})
```

The adapter requests:

```text
{baseUrl}/{username}/rss
```

### RSSHub

```ts
import { createXRssSource } from '@dss-feeds/x-feed/source/rss'

const source = createXRssSource({
  provider: 'rsshub',
  baseUrl: process.env.RSSHUB_BASE_URL!,
  headers: {
    authorization: `Basic ${process.env.RSSHUB_AUTH}`,
  },
})
```

The adapter requests:

```text
{baseUrl}/twitter/user/{username}
```

The RSS adapter:

- accepts RSS 2.0 and Atom-style feeds;
- canonicalizes proxy links back to `https://x.com/...`;
- strips feed HTML and safely decodes XML entities;
- rejects `DOCTYPE` and entity declarations;
- enforces a bounded response size;
- supports local `sinceId` filtering;
- extracts common image/video enclosure metadata;
- maps HTTP failures to structured `XFeedError` codes.

RSS is a reduced-data source. Engagement metrics are unavailable and normalize
to zero/null. Verification, account protection, language, conversation IDs, and
exact user IDs may also be unavailable. Repost detection is best-effort based
on the item creator.

## Source fallback

```ts
import { collectXPosts } from '@dss-feeds/x-feed'
import { createFallbackXSource } from '@dss-feeds/x-feed/source/fallback'
import { createXRssSource } from '@dss-feeds/x-feed/source/rss'
import { createXApiSource } from '@dss-feeds/x-feed/source/x-api'

const source = createFallbackXSource({
  sources: [
    createXRssSource({
      provider: 'nitter',
      baseUrl: process.env.NITTER_BASE_URL!,
    }),
    createXRssSource({
      provider: 'rsshub',
      baseUrl: process.env.RSSHUB_BASE_URL!,
    }),
    createXApiSource({
      bearerToken: process.env.X_BEARER_TOKEN!,
    }),
  ],
})

const posts = await collectXPosts(source, {
  username: 'your_handle',
})
```

Sources are attempted in order. Empty results are accepted by default, which
prevents an incremental sync with no new posts from unnecessarily falling
through to a paid provider. Set `fallbackOnEmpty: true` only when an empty feed
should be treated as an unavailable source.

## Cache and synchronization lifecycle

The cache core depends on a two-method storage boundary and can therefore use a
CMS, SQL database, KV store, file, or custom backend without changing provider
code:

```ts
import {
  createMemoryXFeedSnapshotStore,
  readXFeedSnapshot,
  synchronizeXFeed,
} from '@dss-feeds/x-feed'

const store = createMemoryXFeedSnapshotStore()

await synchronizeXFeed({
  source,
  store,
  config: {
    username: 'your_handle',
    postLimit: 10,
  },
})

const feed = await readXFeedSnapshot({
  store,
  key: 'x:your_handle',
  postCount: 5,
})
```

Successful synchronization:

- skips provider traffic until `nextSyncAt` unless forced;
- uses the newest cached post ID as `sinceId` by default;
- merges new posts into the previous snapshot;
- keeps richer cached metadata when an RSS bridge returns reduced fields;
- retains cached posts when an incremental request returns no new posts;
- refreshes fresh/stale lifetimes after every successful request;
- validates persisted snapshots and their checksums before use;
- never modifies the previous snapshot when provider synchronization fails.

`readXFeedSnapshot` never throws for storage availability problems. It returns
`empty`, `fresh`, `stale`, `expired`, `invalid`, or `unavailable`, allowing the
rendering layer to remain provider-independent and visitor-safe.

The included memory store is intended for tests, examples, and single-process
development. Production persistence is supplied by a future Payload adapter or
another application-defined `XFeedSnapshotStore`.

## Planned slices

1. Payload CMS plugin and persistent admin monitor;
2. failure thresholds, notification events, and recovery state;
3. neutral React component and optional CSS;
4. Portfolio integration and Portfolio-only theme.
