// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** Jargon → plain-English definitions for click-to-define tooltips. */
export const GLOSSARY: Record<string, string> = {
  webcodecs:
    'A browser API that gives web pages direct access to the video and audio encoders/decoders built into your device — often hardware-accelerated. Vidwell uses it to shrink video locally, at native speed, with nothing uploaded.',
  h264:
    'H.264 (AVC) is the near-universal video codec: every phone, browser and player understands it. Vidwell always outputs H.264 in an MP4 so the result plays everywhere.',
  mp4:
    'A container file that wraps the video and audio streams together. It is the safest, most compatible way to hand a video to email, chat apps or another program.',
  aac:
    'The standard audio codec used inside MP4 files. When Vidwell keeps your audio it re-encodes it to AAC at your chosen quality so the whole file stays small.',
  bitrate:
    'How many bits per second the encoder spends on the picture. Lower bitrate = smaller file but softer image; higher = sharper but bigger. Vidwell picks a bitrate from your quality and resolution and shows the estimated size.',
  codec:
    'The method used to compress a stream. Your browser ships a fixed set of them; whether a particular file can be read or written depends on which codecs it has.',
  transcode:
    'Decoding a video and re-encoding it with different settings — a smaller resolution, a lower bitrate, a new codec. That is exactly the work Vidwell does, entirely on your machine.',
  'stream copy':
    'Copying an existing audio or video stream into the new file untouched, with no quality loss. Vidwell copies audio this way when it can, and only re-encodes when it must.',
  resolution:
    'The pixel dimensions of the video, like 1920×1080. Capping the resolution (e.g. to 720p) is one of the biggest ways to shrink a file.',
  'frame rate':
    'How many frames are shown each second (fps). Dropping a 60 fps clip to 30 fps roughly halves the motion data and helps shrink the file.',
  trim:
    'Cutting the video down to a start and end point so only the part you want is encoded. A shorter clip is a smaller file — and the trim happens locally.',
  worker:
    'A background thread in your browser. Vidwell runs the whole compression in a worker so the page stays responsive and the progress bar keeps moving.',
  pwa: 'Progressive Web App — once loaded, Vidwell is cached by a service worker and keeps working with the network off. Offline is proof nothing is uploaded.',
};

let tooltipEl: HTMLElement | null = null;

/** Wire up click-to-define behaviour for any `.glossary-link[data-term]`. */
export function initGlossary(): void {
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement)?.closest('.glossary-link') as HTMLElement | null;
    if (target) {
      e.preventDefault();
      const term = (target.dataset.term || target.textContent || '').toLowerCase().trim();
      const def = GLOSSARY[term];
      if (def) showTooltip(target, def);
      return;
    }
    if (tooltipEl && !(e.target as HTMLElement)?.closest('.glossary-tip')) hideTooltip();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTooltip();
  });
  window.addEventListener('scroll', hideTooltip, true);
}

function showTooltip(anchor: HTMLElement, text: string): void {
  hideTooltip();
  const tip = document.createElement('div');
  tip.className = 'glossary-tip';
  tip.textContent = text;
  document.body.appendChild(tip);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 8;
  let left = r.left;
  const maxLeft = window.innerWidth - tip.offsetWidth - 12;
  if (left > maxLeft) left = Math.max(12, maxLeft);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  tooltipEl = tip;
}

function hideTooltip(): void {
  tooltipEl?.remove();
  tooltipEl = null;
}
