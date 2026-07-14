# DSS Feeds

Cache-first social feed packages for Payload CMS and server-rendered
applications.

## Product boundary

DSS Feeds owns its provider integration, normalization, cache lifecycle,
Payload administration, and neutral presentation components.

The project does not fork, wrap, or depend on third-party social-feed
plugins. Provider packages communicate with official platform HTTP APIs
through small internal clients.

Runtime components never inject tracking, attribution, branding, hidden
links, or provider requests into a visitor's page.

## Packages

    packages/
    ├── github-feed/
    └── x-feed/

Current packages:

    @dss-feeds/github-feed
    @dss-feeds/x-feed

Planned packages:

    @dss-feeds/instagram-feed

Shared code will be extracted only after real duplication appears across at least two production integrations.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```
