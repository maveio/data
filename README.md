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
