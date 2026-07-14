# @dss-feeds/x-feed

Source-agnostic foundation for a cache-first X post feed.

The package is private while its provider contract and production integration
are validated.

## Current boundary

This first slice owns:

- normalized X post types;
- strict runtime validation;
- provider/source contract;
- timeout and abort handling;
- reply/repost filtering;
- deterministic deduplication, ordering, and limits.

It intentionally does **not** include:

- an X API client;
- Payload CMS collections, jobs, or admin UI;
- React presentation components;
- Portfolio-specific markup, class names, or design tokens.

Provider-specific credentials are captured by a source adapter and never become
public component props.

## Source contract

```ts
import {
  collectXPosts,
  type XFeedSource,
} from '@dss-feeds/x-feed'

const source: XFeedSource = {
  id: 'my-x-source',
  async fetchPosts({ config, signal }) {
    // Fetch and normalize posts using any server-side implementation.
    // Secrets remain inside this adapter.
    return []
  },
}

const posts = await collectXPosts(source, {
  username: 'your_handle',
  postLimit: 5,
  excludeReplies: true,
  excludeReposts: true,
})
```

`collectXPosts` validates every returned record before it can enter a cache.

## Planned slices

1. official X API adapter;
2. cache and synchronization lifecycle;
3. Payload CMS plugin and persistent admin monitor;
4. neutral React component and optional CSS;
5. Portfolio integration and Portfolio-only theme.
