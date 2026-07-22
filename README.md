# vidwell

**Compress and trim video in your browser — nothing is uploaded.**

Live: https://vidwell.benrichardson.dev

---

## what it is

Vidwell shrinks and trims video entirely inside your browser tab. Drop in a big
MP4 or MOV, pick a quality, optionally cap the resolution or frame rate and cut a
start/end, and download a smaller, universally compatible MP4 — with a live
estimate of the size you'll get before you commit.

Every other "video compressor" you Google wants you to upload your file to a
stranger's server, wait in a queue, watermark the result, or pay. Your footage is
often exactly the kind of thing you shouldn't hand to a random web service — a
medical clip for a doctor, video of your kids, a confidential product demo.
Vidwell never sends a byte anywhere. The decoding, scaling and re-encoding all
happen on your own machine using the browser's built-in, often
hardware-accelerated, video engine.

It's for anyone who just needs a big video to be a small video right now —
emailing footage, beating an upload cap, sending a clip — without the privacy
trade-off.

## how it works

```
file → probe (header only) → configure → worker: decode → scale → H.264 encode → MP4 mux → download
                                          └─────────────── WebCodecs, off the main thread ──────────────┘
```

1. **Probe.** [mediabunny](https://mediabunny.dev) reads just the file header to
   learn the duration, dimensions and codecs, and the file is shown in a live
   `<video>` preview.
2. **Configure.** You choose a quality preset (which maps to a target bitrate via
   a bits-per-pixel model), an optional resolution cap (applied to the *shorter*
   side, downscale-only, even dimensions), an optional frame-rate cap, whether to
   keep audio, and a trim range. The estimated output size updates live.
3. **Convert.** A dedicated Web Worker runs a mediabunny `Conversion`: each frame
   is decoded and re-encoded to H.264 at the target bitrate via **WebCodecs**;
   audio is stream-copied when possible or re-encoded to AAC. Determinate progress
   and a ×-realtime throughput readout stream back to the UI and the event drawer.
4. **Deliver.** The frames are muxed into a fresh MP4 you preview inline, download,
   or share via the Web Share API. The result never leaves the device.

## browser APIs used

- **WebCodecs** (`VideoEncoder` / `VideoDecoder` / `AudioEncoder`) — hardware-accelerated H.264 encode and decode, in-browser
- **mediabunny** — high-level demux → transcode → mux over WebCodecs (trim, resize, bitrate, stream-copy)
- **@mediabunny/aac-encoder** — AAC encode where the browser's WebCodecs lacks it
- **Web Workers** + **transferable `ArrayBuffer`** — the whole conversion runs off the main thread; the MP4 is returned zero-copy
- **HTMLVideoElement + object URLs** — live preview and the trim in/out scrubber
- **Web Share API** — share the result straight to another app on mobile
- **Service Worker** — works offline once loaded

## security / privacy model

**Protected**
- Your source video, every decoded frame and the compressed MP4 never leave your device — there is no upload endpoint in the code.
- No account, no cookies for your data, no third-party fonts, no watermark.
- Works fully offline once loaded.

**Not protected**
- The output MP4 is an ordinary, unencrypted file — store and send it as carefully as any sensitive footage.
- Compression is lossy: quality is traded for size by design.
- Whether a file can be decoded/encoded depends on your browser's WebCodecs support; an honest error is shown when it can't.

**Trust model**
- The static site bundle (hash-pinned by the GitHub Pages deploy) and the TLS chain to GitHub Pages.
- Your browser's native WebCodecs encoders/decoders and the bundled mediabunny + AAC WASM, all running locally.
- A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no cross-site tracking; your video is never sent to it.

## stack

- Vite 6 + vanilla TypeScript
- `mediabunny`, `@mediabunny/aac-encoder`
- Vitest for unit tests (compression maths + formatters)
- GitHub Pages for hosting, deployed via GitHub Actions

No runtime dependencies beyond mediabunny and its AAC encoder. No cookies, no
fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via
Cloudflare Web Analytics — no personal data, no cross-site tracking.

## browser support

H.264 encoding via WebCodecs is available in current Chrome, Edge and Safari.
Firefox does not yet expose an H.264 encoder, so Vidwell shows a clear notice
there. Input formats: MP4, MOV, WebM, MKV, M4V (anything mediabunny + your
browser can demux and decode).

## local development

```bash
npm install
npm run dev      # vite dev server on :5173
npm test         # run vitest suite
npm run build    # produce dist/ for deploy
npm run preview  # serve dist/ locally
```

## deploying

A push to `main` triggers `.github/workflows/deploy.yml`, which runs tests,
builds, and deploys `dist/` to GitHub Pages. The custom domain is set via
`public/CNAME` — point a `CNAME` DNS record for `vidwell.benrichardson.dev` at
`ben-gy.github.io`.

## license

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see
[ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

In short: you may run, modify, redistribute and even sell this, but if you
distribute it — or run a modified version where other people can reach it — you
have to publish your source under the same licence and keep the attribution. A
separate commercial licence without those obligations is available on request:
<hi@ben.gy>.

Third-party components keep their own licences — see
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
