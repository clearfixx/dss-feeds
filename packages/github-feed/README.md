# @dss-feeds/github-feed

An owned, cache-first GitHub commit feed integration.

The package is private while the provider client, Payload integration,
cache lifecycle, admin monitor, and neutral React component are being
validated in production.

## Current foundation

- native `fetch` GitHub REST client;
- strict repository identifier validation;
- optional bearer-token authentication;
- request timeout and external abort support;
- normalized commit records;
- cross-repository sorting and deduplication;
- provider errors that do not expose credentials;
- no runtime dependency on React, Payload, Octokit, or third-party feed
  plugins.

Payload collections, jobs, settings, monitoring, and UI are introduced in
subsequent vertical slices.
