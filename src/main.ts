// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Vidwell — in-browser video compressor & trimmer.
 * Orchestrates the UI state machine and drives the conversion worker.
 */

// feedback:begin (managed by hub/scripts/feedback/backfill.mjs)
import { mountFeedback } from './feedback';
mountFeedback();
// feedback:end

import './styles/main.css';
import {
  FPS_CAPS,
  QUALITY_PRESETS,
  RESOLUTION_CAPS,
  normalizeTrim,
  percentSaved,
  presetById,
  resolveConversion,
} from './compress';
import {
  buildOutputFilename,
  formatBitrate,
  formatBytes,
  formatClock,
  formatDuration,
} from './format';
import { categoryLogger, mountEventDrawer } from './eventlog';
import { initGlossary } from './glossary';
import { initModals, isModalOpen, openModal, toast } from './ui';
import { NoVideoTrackError, canEncodeH264, hasWebCodecs, probeVideo } from './probe';
import type {
  ProbeResult,
  QualityId,
  Settings,
  WorkerResponse,
} from './types';

const logSys = categoryLogger('system');
const logProbe = categoryLogger('probe');
const logEncode = categoryLogger('encode');
const logOutput = categoryLogger('output');

const PREFS_KEY = 'vidwell.prefs.v1';
const MIN_TRIM_GAP = 0.1;

interface Prefs {
  quality: QualityId;
  resolutionCap: number | null;
  fpsCap: number | null;
  keepAudio: boolean;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { quality: 'balanced', resolutionCap: null, fpsCap: null, keepAudio: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return fallback;
  }
}

function savePrefs(s: Settings): void {
  try {
    const p: Prefs = {
      quality: s.quality,
      resolutionCap: s.resolutionCap,
      fpsCap: s.fpsCap,
      keepAudio: s.keepAudio,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode — ignore */
  }
}

// ── Global-ish state ─────────────────────────────────────────────────────────
let file: File | null = null;
let probe: ProbeResult | null = null;
let settings: Settings = { ...loadPrefs(), trimStart: 0, trimEnd: 0 };
let worker: Worker | null = null;
let convertStart = 0;
let etaTimer: number | null = null;
let sourceUrl: string | null = null;
let resultUrl: string | null = null;
let resultBlob: Blob | null = null;
let encodeSupported = true;

const app = document.getElementById('app') as HTMLElement;

// ── Boot ─────────────────────────────────────────────────────────────────────
function boot(): void {
  renderShell();
  initModals();
  initGlossary();
  wireChrome();
  wireDropzone();
  showIdle();
  logSys('Vidwell ready — everything runs locally.', 'ok');
  registerSW();
  void checkSupport();
}

async function checkSupport(): Promise<void> {
  if (!hasWebCodecs()) {
    encodeSupported = false;
    logSys('WebCodecs is not available in this browser.', 'err');
    showSupportNotice(
      'This browser lacks WebCodecs, so Vidwell can’t compress video here. Try the latest Chrome, Edge or Safari.',
    );
    return;
  }
  const ok = await canEncodeH264();
  encodeSupported = ok;
  if (!ok) {
    logSys('H.264 encoding is unavailable in this browser.', 'warn');
    showSupportNotice(
      'Your browser can’t encode H.264 video. Compression may fail — Chrome, Edge or Safari are recommended.',
    );
  } else {
    logSys('WebCodecs H.264 encoding available.', 'ok');
  }
}

// ── Shell ──────────────────────────────────────────────────────────────────
function renderShell(): void {
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/" aria-label="Vidwell home">
        ${LOGO_SVG}
        <span class="brand-name">Vid<span class="accent">well</span></span>
      </a>
      <nav class="topnav">
        <button type="button" data-modal="how">How it works</button>
        <button type="button" data-modal="threat">Privacy</button>
        <button type="button" data-modal="about">About</button>
        <button type="button" class="drawer-toggle" id="drawer-toggle" aria-pressed="false">Events</button>
      </nav>
    </header>
    <button type="button" class="trust-banner" data-modal="threat">
      <span class="lock">&#128274;</span> Runs entirely in your browser — your video never leaves your device.
    </button>
    <main class="main-content">
      <div class="workspace" id="workspace"></div>
    </main>
    <footer class="site-footer">
      Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
      &middot; <a href="https://sites.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a>
    </footer>
    <aside class="drawer" id="drawer" hidden></aside>
  `;
}

function wireChrome(): void {
  app.querySelectorAll('[data-modal]').forEach((el) => {
    el.addEventListener('click', () => openModal((el as HTMLElement).dataset.modal as string));
  });

  const drawer = document.getElementById('drawer') as HTMLElement;
  const toggle = document.getElementById('drawer-toggle') as HTMLButtonElement;
  let unmount: (() => void) | null = null;
  const setDrawer = (open: boolean) => {
    drawer.hidden = !open;
    toggle.classList.toggle('on', open);
    toggle.setAttribute('aria-pressed', String(open));
    if (open && !unmount) unmount = mountEventDrawer(drawer, () => setDrawer(false));
  };
  toggle.addEventListener('click', () => setDrawer(drawer.hidden));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden && !isModalOpen()) setDrawer(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || isModalOpen()) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(active.tagName)) return;
    const btn = document.getElementById('compress-btn') as HTMLButtonElement | null;
    if (btn && !btn.disabled) startConversion();
  });
}

// ── Idle / dropzone ──────────────────────────────────────────────────────────
function workspace(): HTMLElement {
  return document.getElementById('workspace') as HTMLElement;
}

function showIdle(): void {
  workspace().innerHTML = `
    <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Choose a video">
      ${DROP_SVG}
      <div class="dz-title">Drop a video to compress</div>
      <div class="dz-sub">or <span class="dz-link">browse your files</span> — it never leaves your device</div>
      <div class="dz-formats">MP4 · MOV · WebM · MKV · M4V</div>
    </div>
    <input type="file" id="file-input" accept="video/*,.mkv,.mov,.m4v" hidden />
    <div id="support-notice"></div>
  `;
  wireDropzone();
}

function showSupportNotice(text: string): void {
  const n = document.getElementById('support-notice');
  if (n) n.innerHTML = `<div class="support-notice">${text}</div>`;
}

function wireDropzone(): void {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('file-input') as HTMLInputElement | null;
  if (!dz || !input) return;

  const pick = () => input.click();
  dz.addEventListener('click', pick);
  dz.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      pick();
    }
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void loadFile(f);
  });
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });
}

// ── Load + probe ─────────────────────────────────────────────────────────────
async function loadFile(f: File): Promise<void> {
  if (!/^video\//.test(f.type) && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name)) {
    toast('That doesn’t look like a video file.', 'err');
    logProbe(`Rejected non-video: ${f.name}`, 'warn');
    return;
  }
  cleanupResult();
  file = f;
  logProbe(`Reading ${f.name} (${formatBytes(f.size)})…`);
  workspace().innerHTML = `<div class="loading"><div class="spinner"></div><p>Reading video…</p></div>`;

  try {
    probe = await probeVideo(f);
  } catch (err) {
    const msg =
      err instanceof NoVideoTrackError
        ? err.message
        : 'Vidwell couldn’t read this file. It may be an unsupported format.';
    logProbe(msg, 'err');
    showIdle();
    showSupportNotice(msg);
    toast(msg, 'err');
    return;
  }

  logProbe(
    `${probe.width}×${probe.height} · ${formatDuration(probe.durationSec)} · ${probe.videoCodec ?? '?'}${
      probe.hasAudio ? ` · audio ${probe.audioCodec ?? '?'}` : ' · no audio'
    }`,
    'ok',
  );
  if (!probe.canDecodeVideo) {
    logProbe('This browser may not be able to decode this video.', 'warn');
  }

  settings.trimStart = 0;
  settings.trimEnd = probe.durationSec;
  if (!probe.hasAudio) settings.keepAudio = false;
  showEditor();
}

// ── Editor ───────────────────────────────────────────────────────────────────
function showEditor(): void {
  if (!file || !probe) return;
  revokeSource();
  sourceUrl = URL.createObjectURL(file);

  const qualityChips = QUALITY_PRESETS.map(
    (p) =>
      `<button type="button" class="chip q-chip" data-q="${p.id}" title="${p.desc}">${p.label}</button>`,
  ).join('');
  const resOptions = RESOLUTION_CAPS.filter(
    (r) => r.value === null || r.value <= Math.min(probe!.width, probe!.height),
  )
    .map((r) => `<option value="${r.value ?? ''}">${r.label}</option>`)
    .join('');
  const fpsOptions = FPS_CAPS.map(
    (r) => `<option value="${r.value ?? ''}">${r.label}</option>`,
  ).join('');

  workspace().innerHTML = `
    <div class="editor">
      <div class="source-bar">
        <div class="source-meta">
          <span class="sm-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <span class="sm-detail">${probe.width}×${probe.height} · ${formatDuration(
            probe.durationSec,
          )} · ${formatBytes(file.size)} · ${probe.container}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="change-btn">Change</button>
      </div>

      <div class="preview-wrap">
        <video id="preview" class="preview" playsinline controls preload="metadata" src="${sourceUrl}"></video>
        <span class="preview-badge" id="preview-badge" hidden>Compressed result</span>
      </div>

      <div class="panel trim-panel">
        <div class="panel-title">Trim <span class="panel-hint">— drag to keep only part of the clip</span></div>
        <div class="trim">
          <div class="trim-track"><div class="trim-sel" id="trim-sel"></div></div>
          <div class="trim-controls">
            <label class="trim-field">In
              <input type="text" id="trim-in" class="trim-time" inputmode="decimal" />
            </label>
            <input type="range" id="range-start" class="trim-range" min="0" max="${probe.durationSec}" step="0.1" value="0" aria-label="Trim start" />
            <input type="range" id="range-end" class="trim-range" min="0" max="${probe.durationSec}" step="0.1" value="${probe.durationSec}" aria-label="Trim end" />
            <label class="trim-field">Out
              <input type="text" id="trim-out" class="trim-time" inputmode="decimal" />
            </label>
          </div>
          <div class="trim-summary">Keeping <strong id="trim-keep">${formatClock(
            probe.durationSec,
          )}</strong> of ${formatClock(probe.durationSec)}
            <button type="button" class="link-btn" id="trim-reset">reset</button>
          </div>
        </div>
      </div>

      <div class="panels">
        <div class="panel">
          <div class="panel-title">Quality</div>
          <div class="quick-row q-chips">${qualityChips}</div>
          <p class="quality-desc" id="quality-desc"></p>
          <div class="field-row"><label for="res-select">Resolution</label>
            <select id="res-select">${resOptions}</select>
          </div>
          <div class="field-row"><label for="fps-select">Frame rate</label>
            <select id="fps-select">${fpsOptions}</select>
          </div>
          <div class="opt-row">
            <span><span class="opt-name">Keep audio</span><span class="opt-desc">${
              probe.hasAudio ? 'Re-encode the soundtrack to AAC' : 'This video has no audio'
            }</span></span>
            <input type="checkbox" id="keep-audio" ${settings.keepAudio ? 'checked' : ''} ${
              probe.hasAudio ? '' : 'disabled'
            } />
          </div>
        </div>

        <div class="panel estimate-panel">
          <div class="panel-title">Estimated result</div>
          <div class="est-size" id="est-size">—</div>
          <div class="est-saved" id="est-saved"></div>
          <dl class="est-grid">
            <div><dt>Dimensions</dt><dd id="est-dims">—</dd></div>
            <div><dt>Video bitrate</dt><dd id="est-bitrate">—</dd></div>
            <div><dt>Length</dt><dd id="est-length">—</dd></div>
            <div><dt>Original</dt><dd>${formatBytes(file.size)}</dd></div>
          </dl>
        </div>
      </div>

      <div class="action-bar" id="action-bar">
        <button type="button" class="btn btn-primary btn-export" id="compress-btn">Compress video</button>
        <span class="kbd-hint">Press <kbd>Enter</kbd> to compress</span>
      </div>

      <div class="progress-row" id="progress-row" hidden>
        <div class="progress">
          <div class="progress-bar"><span id="progress-fill"></span></div>
          <span class="progress-pct" id="progress-pct">0%</span>
        </div>
        <span class="progress-eta" id="progress-eta"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="cancel-btn">Cancel</button>
      </div>

      <div class="result-row" id="result-row" hidden></div>
      <div class="error-slot" id="error-slot"></div>
    </div>
  `;

  wireEditor();
  syncQualityChips();
  syncTrimInputs();
  updateEstimate();
}

function wireEditor(): void {
  document.getElementById('change-btn')?.addEventListener('click', () => {
    cleanupResult();
    revokeSource();
    file = null;
    probe = null;
    showIdle();
  });

  // Quality chips
  document.querySelectorAll<HTMLElement>('.q-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      settings.quality = chip.dataset.q as QualityId;
      savePrefs(settings);
      syncQualityChips();
      updateEstimate();
    });
  });

  const res = document.getElementById('res-select') as HTMLSelectElement;
  res.value = settings.resolutionCap === null ? '' : String(settings.resolutionCap);
  res.addEventListener('change', () => {
    settings.resolutionCap = res.value === '' ? null : Number(res.value);
    savePrefs(settings);
    updateEstimate();
  });

  const fps = document.getElementById('fps-select') as HTMLSelectElement;
  fps.value = settings.fpsCap === null ? '' : String(settings.fpsCap);
  fps.addEventListener('change', () => {
    settings.fpsCap = fps.value === '' ? null : Number(fps.value);
    savePrefs(settings);
    updateEstimate();
  });

  const audio = document.getElementById('keep-audio') as HTMLInputElement;
  audio.addEventListener('change', () => {
    settings.keepAudio = audio.checked;
    savePrefs(settings);
    updateEstimate();
  });

  wireTrim();

  document.getElementById('compress-btn')?.addEventListener('click', startConversion);
  document.getElementById('cancel-btn')?.addEventListener('click', cancelConversion);
}

// ── Trim ─────────────────────────────────────────────────────────────────────
function wireTrim(): void {
  if (!probe) return;
  const startEl = document.getElementById('range-start') as HTMLInputElement;
  const endEl = document.getElementById('range-end') as HTMLInputElement;
  const inEl = document.getElementById('trim-in') as HTMLInputElement;
  const outEl = document.getElementById('trim-out') as HTMLInputElement;
  const preview = document.getElementById('preview') as HTMLVideoElement;
  const dur = probe.durationSec;

  const onStart = () => {
    let s = Number(startEl.value);
    if (s > settings.trimEnd - MIN_TRIM_GAP) s = Math.max(0, settings.trimEnd - MIN_TRIM_GAP);
    settings.trimStart = s;
    startEl.value = String(s);
    seek(preview, s);
    syncTrimInputs();
    updateEstimate();
  };
  const onEnd = () => {
    let e = Number(endEl.value);
    if (e < settings.trimStart + MIN_TRIM_GAP) e = Math.min(dur, settings.trimStart + MIN_TRIM_GAP);
    settings.trimEnd = e;
    endEl.value = String(e);
    seek(preview, e);
    syncTrimInputs();
    updateEstimate();
  };
  startEl.addEventListener('input', onStart);
  endEl.addEventListener('input', onEnd);

  const commitText = (el: HTMLInputElement, which: 'start' | 'end') => {
    const secs = parseClock(el.value);
    if (secs === null) {
      syncTrimInputs();
      return;
    }
    const t = normalizeTrim(
      which === 'start' ? secs : settings.trimStart,
      which === 'end' ? secs : settings.trimEnd,
      dur,
    );
    settings.trimStart = t.start;
    settings.trimEnd = t.end;
    startEl.value = String(t.start);
    endEl.value = String(t.end);
    seek(preview, which === 'start' ? t.start : t.end);
    syncTrimInputs();
    updateEstimate();
  };
  inEl.addEventListener('change', () => commitText(inEl, 'start'));
  outEl.addEventListener('change', () => commitText(outEl, 'end'));

  document.getElementById('trim-reset')?.addEventListener('click', () => {
    settings.trimStart = 0;
    settings.trimEnd = dur;
    startEl.value = '0';
    endEl.value = String(dur);
    syncTrimInputs();
    updateEstimate();
  });
}

function seek(video: HTMLVideoElement | null, t: number): void {
  if (!video) return;
  try {
    video.pause();
    video.currentTime = Math.max(0, t);
  } catch {
    /* not seekable yet */
  }
}

function syncTrimInputs(): void {
  if (!probe) return;
  const inEl = document.getElementById('trim-in') as HTMLInputElement | null;
  const outEl = document.getElementById('trim-out') as HTMLInputElement | null;
  const sel = document.getElementById('trim-sel') as HTMLElement | null;
  const keep = document.getElementById('trim-keep') as HTMLElement | null;
  if (inEl) inEl.value = formatClock(settings.trimStart);
  if (outEl) outEl.value = formatClock(settings.trimEnd);
  const dur = probe.durationSec || 1;
  if (sel) {
    const left = (settings.trimStart / dur) * 100;
    const width = ((settings.trimEnd - settings.trimStart) / dur) * 100;
    sel.style.left = `${left}%`;
    sel.style.width = `${width}%`;
  }
  if (keep) keep.textContent = formatClock(Math.max(0, settings.trimEnd - settings.trimStart));
}

/** Parse "1:05.3" / "65" / "1:02:03" → seconds, or null if unparseable. */
function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + Number(p);
  return isFinite(secs) ? secs : null;
}

function syncQualityChips(): void {
  document.querySelectorAll<HTMLElement>('.q-chip').forEach((chip) => {
    chip.classList.toggle('on', chip.dataset.q === settings.quality);
  });
  const desc = document.getElementById('quality-desc');
  if (desc) desc.textContent = presetById(settings.quality).desc;
}

// ── Estimate ─────────────────────────────────────────────────────────────────
function updateEstimate(): void {
  if (!file || !probe) return;
  const { params, estimatedBytes, target } = resolveConversion(settings, probe);
  const set = (id: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('est-size', `≈ ${formatBytes(estimatedBytes)}`);
  set('est-dims', `${target.width}×${target.height}${target.scaled ? '' : ' (original)'}`);
  set('est-bitrate', formatBitrate(params.videoBitrate));
  set('est-length', formatClock(params.durationSec));

  const saved = percentSaved(file.size, estimatedBytes);
  const savedEl = document.getElementById('est-saved');
  if (savedEl) {
    if (saved > 0) {
      savedEl.textContent = `about ${saved}% smaller than the original`;
      savedEl.dataset.kind = 'good';
    } else {
      savedEl.textContent = 'may not shrink — try a lower quality or resolution';
      savedEl.dataset.kind = 'warn';
    }
  }
}

// ── Conversion ───────────────────────────────────────────────────────────────
function startConversion(): void {
  if (!file || !probe) return;
  if (!encodeSupported) {
    toast('Video encoding isn’t supported in this browser.', 'err');
    return;
  }
  clearError();
  cleanupResult();

  const { params, estimatedBytes } = resolveConversion(settings, probe);
  logEncode(
    `Compressing → ${formatBitrate(params.videoBitrate)} video${
      params.keepAudio ? `, ${formatBitrate(params.audioBitrate)} AAC` : ', no audio'
    }${params.applyTrim ? `, trim ${formatClock(params.trimStart)}–${formatClock(params.trimEnd)}` : ''}`,
  );

  setBusy(true);
  convertStart = Date.now();
  startEtaTimer(estimatedBytes);

  worker = new Worker(new URL('./convert-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => handleWorkerMessage(ev.data);
  worker.onerror = (e) => {
    logEncode(`Worker error: ${e.message}`, 'err');
    failConversion('The compressor crashed. Try a lower resolution or a shorter trim.');
  };
  worker.postMessage({ type: 'convert', file, params });
}

function handleWorkerMessage(msg: WorkerResponse): void {
  switch (msg.type) {
    case 'started':
      logEncode('Encoding started.');
      break;
    case 'progress':
      setProgress(msg.progress);
      break;
    case 'invalid':
      logEncode(`Could not compress: ${msg.reason}`, 'err');
      failConversion(
        'This video couldn’t be compressed in your browser. Its codec may be unsupported — try a different file or browser.',
      );
      break;
    case 'error':
      logEncode(`Error: ${msg.message}`, 'err');
      failConversion(`Compression failed: ${msg.message}`);
      break;
    case 'done':
      finishConversion(msg.buffer, msg.size);
      break;
  }
}

function setProgress(p: number): void {
  const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
  const fill = document.getElementById('progress-fill') as HTMLElement | null;
  const label = document.getElementById('progress-pct') as HTMLElement | null;
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${pct}%`;
}

function startEtaTimer(_estimatedBytes: number): void {
  stopEtaTimer();
  etaTimer = window.setInterval(() => {
    const fill = document.getElementById('progress-fill') as HTMLElement | null;
    const eta = document.getElementById('progress-eta') as HTMLElement | null;
    if (!fill || !eta || !probe) return;
    const frac = parseFloat(fill.style.width || '0') / 100;
    const elapsed = (Date.now() - convertStart) / 1000;
    if (frac > 0.01) {
      const trimmedDur = Math.max(0.1, settings.trimEnd - settings.trimStart);
      const speed = (frac * trimmedDur) / Math.max(0.1, elapsed);
      const remain = (elapsed / frac) * (1 - frac);
      eta.textContent = `${speed.toFixed(1)}× realtime · ~${formatDuration(remain)} left`;
    } else {
      eta.textContent = 'preparing…';
    }
  }, 300);
}

function stopEtaTimer(): void {
  if (etaTimer !== null) {
    window.clearInterval(etaTimer);
    etaTimer = null;
  }
}

function finishConversion(buffer: ArrayBuffer, size: number): void {
  stopEtaTimer();
  terminateWorker();
  setBusy(false);
  setProgress(1);

  resultBlob = new Blob([buffer], { type: 'video/mp4' });
  resultUrl = URL.createObjectURL(resultBlob);
  const original = file?.size ?? 0;
  const saved = percentSaved(original, size);
  const elapsed = ((Date.now() - convertStart) / 1000).toFixed(1);
  logOutput(`Done: ${formatBytes(size)} (${saved > 0 ? saved + '% smaller' : 'no reduction'}) in ${elapsed}s`, 'ok');

  // Swap the preview to the compressed output.
  const preview = document.getElementById('preview') as HTMLVideoElement | null;
  const badge = document.getElementById('preview-badge') as HTMLElement | null;
  if (preview && resultUrl) {
    preview.src = resultUrl;
    preview.load();
  }
  if (badge) badge.hidden = false;

  const canShare =
    typeof navigator !== 'undefined' &&
    'canShare' in navigator &&
    resultBlob !== null &&
    navigator.canShare?.({ files: [new File([resultBlob], 'v.mp4', { type: 'video/mp4' })] });

  const row = document.getElementById('result-row') as HTMLElement;
  row.hidden = false;
  row.innerHTML = `
    <div class="result-headline ${saved > 0 ? 'good' : 'warn'}">
      <span class="result-big">${formatBytes(size)}</span>
      <span class="result-delta">${
        saved > 0 ? `${saved}% smaller` : 'no size reduction'
      } &middot; was ${formatBytes(original)}</span>
    </div>
    <div class="result-actions">
      <button type="button" class="btn btn-primary" id="download-btn">Download MP4</button>
      ${canShare ? '<button type="button" class="btn btn-ghost" id="share-btn">Share</button>' : ''}
      <button type="button" class="btn btn-ghost" id="again-btn">Compress again</button>
    </div>
  `;

  const actionBar = document.getElementById('action-bar');
  if (actionBar) actionBar.hidden = true;

  document.getElementById('download-btn')?.addEventListener('click', downloadResult);
  document.getElementById('share-btn')?.addEventListener('click', shareResult);
  document.getElementById('again-btn')?.addEventListener('click', resetToEditor);
  toast(saved > 0 ? `Done — ${saved}% smaller` : 'Done', 'ok');
}

function failConversion(message: string): void {
  stopEtaTimer();
  terminateWorker();
  setBusy(false);
  showError(message);
}

function cancelConversion(): void {
  if (!worker) return;
  logEncode('Cancelled by user.', 'warn');
  worker.postMessage({ type: 'cancel' });
  stopEtaTimer();
  terminateWorker();
  setBusy(false);
  setProgress(0);
  toast('Compression cancelled.');
}

function setBusy(busy: boolean): void {
  const progress = document.getElementById('progress-row');
  const actionBar = document.getElementById('action-bar');
  const btn = document.getElementById('compress-btn') as HTMLButtonElement | null;
  if (progress) progress.hidden = !busy;
  if (actionBar) actionBar.hidden = busy;
  if (btn) btn.disabled = busy;
  // Freeze settings while busy.
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      '.q-chip, #res-select, #fps-select, #keep-audio, .trim-range, .trim-time, #trim-reset, #change-btn',
    )
    .forEach((el) => ((el as HTMLInputElement).disabled = busy));
  if (busy) setProgress(0);
}

function resetToEditor(): void {
  cleanupResult();
  const badge = document.getElementById('preview-badge') as HTMLElement | null;
  const preview = document.getElementById('preview') as HTMLVideoElement | null;
  if (badge) badge.hidden = true;
  if (preview && sourceUrl) {
    preview.src = sourceUrl;
    preview.load();
  }
  const row = document.getElementById('result-row') as HTMLElement | null;
  if (row) {
    row.hidden = true;
    row.innerHTML = '';
  }
  const actionBar = document.getElementById('action-bar');
  if (actionBar) actionBar.hidden = false;
  setProgress(0);
  updateEstimate();
}

// ── Result delivery ──────────────────────────────────────────────────────────
function downloadResult(): void {
  if (!resultUrl || !file) return;
  const a = document.createElement('a');
  a.href = resultUrl;
  a.download = buildOutputFilename(file.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  logOutput(`Saved ${buildOutputFilename(file.name)}`, 'ok');
}

async function shareResult(): Promise<void> {
  if (!resultBlob || !file) return;
  const shareFile = new File([resultBlob], buildOutputFilename(file.name), { type: 'video/mp4' });
  try {
    await navigator.share({ files: [shareFile], title: 'Compressed video' });
    logOutput('Shared via system share sheet.', 'ok');
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      logOutput('Share failed; use Download instead.', 'warn');
      toast('Sharing isn’t available — use Download.', 'err');
    }
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────
function showError(message: string): void {
  const slot = document.getElementById('error-slot');
  if (!slot) {
    toast(message, 'err');
    return;
  }
  slot.innerHTML = `
    <div class="error-box">
      <p>${escapeHtml(message)}</p>
      <button type="button" class="btn btn-ghost btn-sm" id="retry-btn">Try again</button>
    </div>
  `;
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    clearError();
    startConversion();
  });
}

function clearError(): void {
  const slot = document.getElementById('error-slot');
  if (slot) slot.innerHTML = '';
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function revokeSource(): void {
  if (sourceUrl) {
    URL.revokeObjectURL(sourceUrl);
    sourceUrl = null;
  }
}

function cleanupResult(): void {
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
    resultUrl = null;
  }
  resultBlob = null;
}

window.addEventListener('beforeunload', () => {
  terminateWorker();
  revokeSource();
  cleanupResult();
});

// ── Misc ─────────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function registerSW(): void {
  if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline support is a bonus */
      });
    });
  }
}

const LOGO_SVG = `
  <svg class="brand-mark" viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
    <rect x="4" y="4" width="56" height="56" rx="14" fill="#14141d"/>
    <path d="M25 21 L44 32 L25 43 Z" fill="#8b7bff"/>
    <g stroke="#8b7bff" stroke-width="3.2" stroke-linecap="round" fill="none" opacity="0.9">
      <path d="M13 15 L13 25 M9 21 L13 25 L17 21"/>
      <path d="M51 49 L51 39 M47 43 L51 39 L55 43"/>
    </g>
  </svg>`;

const DROP_SVG = `
  <svg class="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5"/>
    <path d="M10 9.5 L15 12 L10 14.5 Z" fill="currentColor" stroke="none"/>
    <path d="M12 2.5 V6 M9.5 4.5 L12 6.5 L14.5 4.5" opacity="0.7"/>
  </svg>`;

boot();
