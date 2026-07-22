// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * UI chrome — modal management and transient toasts.
 * Modal bodies live here and are shown lazily; the app wires openers by id.
 */

interface ModalDef {
  title: string;
  body: string;
}

/** A glossary-linked term. `label` is shown; `term` keys into GLOSSARY. */
function g(label: string, term = label): string {
  return `<span class="glossary-link" data-term="${term.toLowerCase()}" role="button" tabindex="0">${label}</span>`;
}

const MODALS: Record<string, ModalDef> = {
  how: {
    title: 'How Vidwell works',
    body: `
      <ol class="steps">
        <li><strong>You drop a video.</strong> MP4, MOV, WebM, MKV or M4V — whatever your browser can read. It is opened straight from your disk; there is no upload and no server round-trip.</li>
        <li><strong>Vidwell probes it.</strong> It reads just the header to learn the duration, dimensions and ${g('codec', 'codec')}s, then shows a live preview so you can see what you're working with.</li>
        <li><strong>You choose how small.</strong> Pick a quality, optionally cap the ${g('resolution')} or ${g('frame rate')}, keep or drop the audio, and drag the handles to ${g('trim')} a start and end. A live estimate shows the size you'll get.</li>
        <li><strong>A ${g('worker')} does the work.</strong> Using ${g('WebCodecs')}, it decodes each frame, scales it, and re-encodes to ${g('H.264')} at your target ${g('bitrate')} — audio is ${g('stream copied', 'stream copy')} when possible or re-encoded to ${g('AAC')}.</li>
        <li><strong>You save the result.</strong> The frames are muxed into a fresh ${g('MP4')} you preview, download or share. The bytes only ever existed on your device.</li>
      </ol>
      <p class="modal-note">Loaded once, Vidwell keeps working offline as a ${g('PWA')} — the strongest proof there is no server involved.</p>
    `,
  },
  threat: {
    title: 'Privacy & threat model',
    body: `
      <div class="tm">
        <section>
          <h4 class="tm-good">Protected</h4>
          <ul>
            <li>Your source video, every decoded frame and the compressed MP4 never leave your device. There is no upload endpoint anywhere in the code.</li>
            <li>No account, no cookies for your data, no third-party fonts, no watermark, no tracking beyond an anonymous page-view count.</li>
            <li>Once loaded, the tool runs fully offline.</li>
          </ul>
        </section>
        <section>
          <h4 class="tm-warn">Not protected</h4>
          <ul>
            <li>The exported MP4 is an ordinary, unencrypted video file. Store and send it as carefully as any sensitive footage.</li>
            <li>Compression is lossy by design — you are trading some picture quality for a smaller file.</li>
            <li>Whether a file can be decoded and re-encoded depends on your browser's built-in ${g('WebCodecs')} support; an honest error is shown when it can't.</li>
          </ul>
        </section>
        <section>
          <h4 class="tm-info">Trust surface</h4>
          <ul>
            <li>The static site bundle (hash-pinned by the GitHub Pages deploy) and the TLS chain between you and GitHub Pages.</li>
            <li>Your browser's native WebCodecs encoders/decoders and the bundled mediabunny + AAC encoder, which run locally in a worker.</li>
            <li>A Cloudflare Web Analytics beacon records anonymous page views — no cookies, no fingerprinting, no cross-site tracking; your video is never sent to it.</li>
          </ul>
        </section>
      </div>
    `,
  },
  about: {
    title: 'About Vidwell',
    body: `
      <p>Vidwell is a free, in-browser video compressor and trimmer. Shrink a big MP4 or MOV — cut a clip, cap the resolution, drop the frame rate — and get a smaller, universally compatible MP4, without installing anything, creating an account, or uploading a single byte.</p>
      <p>It's part of a small collection of privacy-first browser tools. No file you touch here is ever sent to a server.</p>
      <ul class="about-links">
        <li><a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a> — who made this</li>
        <li><a href="https://sites.benrichardson.dev" target="_blank" rel="noopener">sites.benrichardson.dev</a> — the full directory of tools &amp; sites</li>
        <li><a href="https://github.com/ben-gy/vidwell" target="_blank" rel="noopener">Source on GitHub</a> — read exactly what it does</li>
      </ul>
      <p class="modal-note">No cookies for your data · no fingerprinting · no third-party fonts · anonymous, cookie-less page-view counts via Cloudflare Web Analytics.</p>
    `,
  },
};

let overlay: HTMLElement | null = null;

export function initModals(): void {
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h3 id="modal-title"></h3>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target as HTMLElement).closest('.modal-close')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeModal();
  });
}

export function openModal(id: keyof typeof MODALS | string): void {
  const def = MODALS[id];
  if (!def || !overlay) return;
  (overlay.querySelector('#modal-title') as HTMLElement).textContent = def.title;
  (overlay.querySelector('.modal-body') as HTMLElement).innerHTML = def.body;
  overlay.hidden = false;
  (overlay.querySelector('.modal-close') as HTMLElement)?.focus();
}

export function closeModal(): void {
  if (overlay) overlay.hidden = true;
}

export function isModalOpen(): boolean {
  return !!overlay && !overlay.hidden;
}

let toastTimer: number | null = null;
export function toast(message: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
  let el = document.querySelector('.toast') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 3200);
}
