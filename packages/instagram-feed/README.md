# @dss-feeds/instagram-feed

Owned, cache-first Instagram media for Payload CMS and React.

## Sources

- `official`: Instagram API with Instagram Login for Creator/Business accounts.
- `experimental-web-session`: one explicitly experimental server-side Instagram web-session GraphQL adapter for public accounts.
- `official-with-experimental-fallback`: official first, web-session only after official failure.

The package never injects Instagram widgets, scripts, tracking, attribution, hidden links, or provider requests into a visitor page.

## Cache boundary

Provider requests run only in a Payload worker. Public rendering reads a local snapshot. A `mediaMirror` is mandatory so public pages do not load Instagram CDN assets.

```ts
import {
  instagramFeedPlugin,
  type InstagramMediaMirror,
} from '@dss-feeds/instagram-feed/payload'

const mediaMirror: InstagramMediaMirror = async ({ post }) => {
  // Download post.providerImageUrl in the worker and return a local URL.
  return { imageUrl: `/media/instagram/${post.id}.jpg` }
}

export default buildConfig({
  plugins: [instagramFeedPlugin({ mediaMirror })],
})
```

## Environment

```env
# Official source
DSS_INSTAGRAM_ACCESS_TOKEN=
DSS_INSTAGRAM_USER_ID=

# Experimental web-session source
DSS_INSTAGRAM_SESSION_ID=
DSS_INSTAGRAM_CSRF_TOKEN=
DSS_INSTAGRAM_DS_USER_ID=
DSS_INSTAGRAM_APP_ID=
DSS_INSTAGRAM_USER_AGENT=
DSS_INSTAGRAM_GRAPHQL_DOC_ID=25403009626063073

# Protected manual sync endpoint
DSS_INSTAGRAM_FEED_SYNC_SECRET=
```

## Worker

```bash
pnpm payload jobs:run \
  --cron "* * * * *" \
  --queue dss-instagram-feed \
  --handle-schedules
```

The hourly scheduler only checks whether the feed is due. The default provider sync interval is six hours.
