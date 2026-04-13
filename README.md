<div>
<br />
<p style="padding: 4px 0;">
  <a href="https://mave.io">
    <picture>
      <source srcset="https://mave.io/images/logo_white.svg" media="(prefers-color-scheme: dark)">
      <img src="https://mave.io/images/logo.svg"  alt="mave.io logo black" style="width: 183px;">
    </picture>
  </a>
</p>

# @maveio/data

Privacy-friendly video analytics client for mave.io.

[Install](#install) •
[Usage](#usage)

## Install

Install the package within your project:

```bash
npm install @maveio/data
```

## Usage

Initialize the client with your configuration:

```javascript
import { Metrics } from '@maveio/data';

// Configure the ingestion endpoint
Metrics.config = {
  apiEndpoint: 'https://metrics.video-dns.com/v1/events', // or adjust to your URL
};
```

To collect video events, create a `Metrics` instance for each `HTMLVideoElement` (or `hls.js` instance).

### Standard Video Element

```javascript
new Metrics('#my_video', 'ubg50LeDE9v86ye').monitor();
```

The `embed_id` acts as a unique identifier for the video content.

### HLS.js

When using [hls.js](https://github.com/video-dev/hls.js), pass the hls instance directly:

```javascript
const hls = new Hls();
// ... setup hls ...

new Metrics(hls, 'ubg50LeDE9v86ye').monitor();
```

## Development

This repository includes a standalone example page in `examples/video/index.html`.

1.  Build the package:

    ```bash
    npm install
    npm run build
    ```

2.  Serve the example page:

    ```bash
    # Proxies events to a local Core instance by default (http://localhost:4000)
    npm run example
    
    # Or specify a custom Core URL:
    MAVE_CORE_BASE_URL=https://your-core-url.com npm run example
    ```

## Release

Publishing to npm is automated through GitHub Actions.

The publish workflow runs on tags matching `v*.*.*`, verifies that the tag version
matches `package.json`, then publishes to npm and creates a GitHub release.

Typical release flow:

1. Run the release command. By default it creates a patch release:

   ```bash
   npm install
   npm run release
   ```

   This script:
   - runs `build`, `typecheck`, and `test`
   - verifies your git working tree is clean
   - bumps the version in `package.json`
   - creates a matching annotated git tag like `v0.1.1`

   You can also choose a different bump:

   ```bash
   npm run release -- minor
   npm run release -- major
   npm run release -- 0.2.0
   ```

2. Review the version bump if you want, then push the current branch and tag:

   ```bash
   npm run release:push
   ```

If the git tag and `package.json` version do not match, the publish workflow will fail.
