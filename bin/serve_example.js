#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataRoot = path.resolve(__dirname, "..");
const examplesRoot = path.join(dataRoot, "examples");

const port = Number(process.env.PORT || 5174);
const coreBaseUrl = (process.env.MAVE_CORE_BASE_URL || process.env.MAVE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function safeResolve(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const joined = path.join(root, decoded);
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

// Debug logging
const server = http.createServer((req, res) => {
  const url = req.url || "/";
  console.log(`[${new Date().toISOString()}] ${req.method} ${url}`);

  // Optional local proxy to avoid CORS when testing against a remote Core.
  // Usage:
  //   MAVE_CORE_BASE_URL=http://<lb-ip> node bin/serve_example.js
  if (url.startsWith("/v1/events")) {
    if (!coreBaseUrl) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "missing_core_base_url", hint: "Set MAVE_CORE_BASE_URL=http://<core-host>" }));
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST, OPTIONS" });
      res.end("method not allowed");
      return;
    }

    const targetUrl = `${coreBaseUrl}/v1/events`;
    console.log(`[Proxy] Proxying to: ${targetUrl}`);

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const body = Buffer.concat(chunks);

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (!value) continue;
          if (key.toLowerCase() === "host") continue;
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }

        const upstream = await fetch(targetUrl, {
          method: "POST",
          headers,
          body,
        });

        console.log(`[Proxy] Upstream status: ${upstream.status}`);
        res.statusCode = upstream.status;
        const upstreamContentType = upstream.headers.get("content-type");
        if (upstreamContentType) {
          res.setHeader("Content-Type", upstreamContentType);
        }

        const responseBody = Buffer.from(await upstream.arrayBuffer());
        res.end(responseBody);
      } catch (err) {
        console.error(`[Proxy] Error:`, err);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        }

        res.end(JSON.stringify({ error: "proxy_failed", message: err?.message || String(err) }));
      }
    });

    return;
  }

  // Default route -> video example
  if (url === "/") {
    res.writeHead(302, { Location: "/video/" });
    res.end();
    return;
  }

  // Serve under /video/* from examples/video
  if (url.startsWith("/video")) {
    const rel = url.replace(/^\/video\/?/, "");
    const root = path.join(examplesRoot, "video");
    const target = safeResolve(root, rel === "" ? "index.html" : rel);

    if (!target) {
      console.log(`[Static] Bad path: ${url}`);
      res.writeHead(400);
      res.end("bad path");
      return;
    }

    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      console.log(`[Static] Not found: ${target}`);
      res.writeHead(404);
      res.end("not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(target) });
    fs.createReadStream(target).pipe(res);
    return;
  }

  // Serve dist files so index.html can import ../../dist/index.js
  if (url.startsWith("/dist/")) {
    const distRoot = path.join(dataRoot, "dist");
    const target = safeResolve(distRoot, url.replace(/^\/dist\/?/, ""));

    if (!target) {
      console.log(`[Static] Bad path: ${url}`);
      res.writeHead(400);
      res.end("bad path");
      return;
    }

    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      console.log(`[Static] Not found: ${target}`);
      res.writeHead(404);
      res.end("not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(target) });
    fs.createReadStream(target).pipe(res);
    return;
  }

  console.log(`[404] No route for: ${url}`);
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`Serving examples at http://127.0.0.1:${port}/video/`);
  console.log("Tip: run `npm run build` in ./data first.");
  if (coreBaseUrl) {
    console.log(`Proxying /v1/events -> ${coreBaseUrl}/v1/events`);
  } else {
    console.log("Tip: set MAVE_CORE_BASE_URL=http://<core-host> to proxy /v1/events (avoids CORS).");
  }
});
