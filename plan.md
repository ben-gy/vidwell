# Tool Plan: Vidwell

## Overview
- **Name:** Vidwell
- **Repo name:** vidwell
- **Tagline:** Compress and trim video in your browser — nothing is uploaded.

## Problem It Solves
Someone shot a 3-minute clip on their phone and it's 480 MB. They need to email it, put it in a Slack message, attach it to a support ticket, or upload it under a 100 MB limit — and every "video compressor" they Google wants them to upload the file to a stranger's server, wait in a queue, watermark the result, or pay. The file might be personal (a medical video for a doctor, footage of their kids, a confidential product demo) and they do not want it sitting on someone else's disk. Vidwell shrinks and trims the video entirely inside the browser tab: pick a quality, optionally cut a start/end, hit Compress, download a smaller MP4. The bytes never leave the machine.

## Why This Must Be Client-Side
- **Privacy** — raw personal video (faces, locations, confidential demos) is exactly the kind of data you should not upload to a random web service.
- **Cost/queue avoidance** — server transcoding is expensive; free services throttle, watermark, or cap file size. Local encoding has none of that.
- **Large-file handling** — uploading a 500 MB video just to download a 40 MB one is wasteful; doing it locally skips the round-trip entirely.

## Browser APIs / Libraries Used
| API / Library | What it does for us | Fallback if unsupported |
|---------------|----------------------|-------------------------|
| **WebCodecs** (`VideoEncoder`/`VideoDecoder`/`AudioEncoder`) | Hardware-accelerated H.264 encode + decode, entirely in-browser | Clear "use Chrome/Edge/Safari" notice if H.264 encode is unavailable |
| **mediabunny** | High-level demux → transcode → mux pipeline over WebCodecs; trim, resize, bitrate, stream-copy audio | N/A — core engine |
| **@mediabunny/aac-encoder** | AAC audio encode where the browser lacks it (cross-container inputs) | Audio stream-copied when possible; dropped with a warning otherwise |
| **Web Workers** | Runs the whole conversion off the main thread; UI stays live, progress streams | N/A — hard requirement |
| **Transferable ArrayBuffer** | Zero-copy return of the encoded MP4 from the worker | Structured clone (slower) |
| **HTMLVideoElement + object URL** | Live preview and the trim in/out scrubber | N/A |
| **Web Share API (files)** | Share the result straight to another app on mobile | Download button |
| **Service Worker (PWA)** | Works offline once loaded — proof there is no server | Online-only |

## Workflow (input → process → output)
1. User drops (or taps to pick) a video — MP4, MOV, WebM, MKV, M4V.
2. Vidwell probes it (duration, dimensions, codecs) with mediabunny's lazy reader and shows a preview. User picks a **quality** preset, an optional **resolution** cap, an optional **frame-rate** cap, whether to keep audio, and optionally drags a **trim** in/out. A live **estimated size** updates as they tweak.
3. A worker runs the mediabunny `Conversion` (decode → downscale → H.264 encode → MP4 mux, audio stream-copied or re-encoded to AAC). Determinate progress + throughput stream to the UI and the event drawer. The result is a smaller MP4 the user previews, downloads, or shares.

## Non-Goals
- No format-conversion matrix (always outputs MP4/H.264 — the universally compatible target).
- No editing beyond a single trim range (no cut-list, no filters, no overlays) v1.
- No batch/multi-file queue v1.
- No cloud, no account, ever.

## Target Audience
A non-technical person on a laptop or phone who just needs a big video to be a small video right now — emailing footage, beating an upload cap, sending a clip — and is uneasy about uploading something personal. Also serves developers/creators who want a fast, no-nonsense local transcode.

## Style Direction
**Tone:** confident, calm, media-native.
**Colour palette:** dark, near-black with an electric-violet accent — the palette of video editors (Premiere/DaVinci/CapCut) so the tool reads as "this handles video" while staying distinct from the amber Clipwell and the rest of the -well family.
**UI density:** balanced.
**Dark/light theme:** dark (creative/media audience).
**Reference tools for feel:** Clipwell (sibling, shared chrome), Squoosh (single-workspace, live before/after).

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite. Single workspace, no component tree — vanilla is correct.
- **Key libraries:** `mediabunny`, `@mediabunny/aac-encoder`.
- **Worker strategy:** single dedicated Web Worker owns the whole `Conversion`; `postMessage` streams progress; final MP4 returned as a transferable ArrayBuffer; `conversion.cancel()` on abort.
- **Storage:** none (localStorage only for last-used quality/resolution/audio prefs).

## Privacy & Trust Model
**Protected**
- The source video, every decoded frame, and the compressed MP4 never leave the device. There is no upload endpoint in the code.
- No account, no cookies for your data, no third-party fonts, no watermark.
- Works fully offline once loaded.

**Not protected**
- The output MP4 is an ordinary, unencrypted file — store and send it as carefully as any sensitive footage.
- Whether a given file can be decoded/encoded depends on your browser's built-in WebCodecs support; an honest error is shown when it can't.
- Compression is lossy — quality is traded for size by design.

**Trust surface**
- The static site bundle (hash-pinned by the GitHub Pages deploy) and the TLS chain to GitHub Pages.
- Your browser's native WebCodecs encoders/decoders and the bundled mediabunny + AAC WASM, all running locally.
- A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no cross-site tracking; your video is never sent to it.

## UX Required Surfaces
- Drag-drop + tap-to-pick dropzone with accepted-formats caption.
- Live preview `<video>` + dual-handle trim scrubber with numeric in/out.
- Quality / resolution / fps / keep-audio controls with a live estimated-size readout.
- Determinate progress with throughput + a Cancel button.
- Event log drawer (system/probe/decode/encode/mux/output) with `×` close + Escape.
- How-It-Works modal, Privacy (threat model) modal, About modal.
- Result: before/after size + % saved, preview, Download, Web Share.
- Keyboard: Escape closes modals/drawer, Enter starts compression.
- Sticky footer with benrichardson.dev + sites.benrichardson.dev.
