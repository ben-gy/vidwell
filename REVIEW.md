# Vidwell — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **GitHub Pages:** https://ben-gy.github.io/vidwell/ *(redirects to custom domain once DNS is set)*
- **Custom domain:** https://vidwell.benrichardson.dev *(live after DNS + cert below)*

## What it is

An in-browser video compressor & trimmer. Drop an MP4/MOV/WebM/MKV, pick a
quality + resolution + frame-rate + trim, and download a smaller MP4 — decoded,
scaled and re-encoded to H.264 entirely on-device via **WebCodecs** (mediabunny).
Nothing is uploaded.

Verified locally end-to-end: a 2.7 MB / 1080p sample compressed to **777 KB
(72% smaller)** at 720p/Small, output confirmed as a valid, playable 1280×720 MP4.

## DNS setup required

Add in Cloudflare (`benrichardson.dev` zone):

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `vidwell` | `ben-gy.github.io` | DNS only (grey cloud) |

Then trigger cert issuance:
```bash
gh api repos/ben-gy/vidwell/pages -X PUT -f cname=""
sleep 3
gh api repos/ben-gy/vidwell/pages -X PUT -f cname="vidwell.benrichardson.dev"
```
