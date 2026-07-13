# DSS Feeds

Headless, cache-first social feed packages for server-rendered applications.

## Principles

- no external provider requests during page rendering;
- no runtime tracking, injected attribution, hidden links, or branding;
- neutral and optional default UI;
- provider data is normalized before it reaches a component;
- the last valid cache remains available when synchronization fails;
- operational errors are visible to administrators, never to site visitors.

## Workspace

```text
packages/
└── core/
```

Provider and Payload packages will be added as separate workspace packages:

```text
@dss-feeds/github
@dss-feeds/instagram
@dss-feeds/x
@dss-feeds/payload
```

All packages remain private until their public APIs and integration tests are stable.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```
