/**
 * Pure compression maths — presets, target dimensions, bitrate budgeting and
 * size estimation. No DOM, no mediabunny: everything here is unit-tested.
 */

import type {
  ConvertParams,
  ProbeResult,
  QualityId,
  QualityPreset,
  ResolutionCap,
  Settings,
  TargetDimensions,
} from './types';

export const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: 'high',
    label: 'High',
    bpp: 0.1,
    audioBitrate: 160_000,
    desc: 'Near-original quality, modest savings',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    bpp: 0.06,
    audioBitrate: 128_000,
    desc: 'Great quality, much smaller',
  },
  {
    id: 'small',
    label: 'Small',
    bpp: 0.035,
    audioBitrate: 96_000,
    desc: 'Noticeably smaller, still sharp',
  },
  {
    id: 'tiny',
    label: 'Tiny',
    bpp: 0.02,
    audioBitrate: 64_000,
    desc: 'Smallest file, for tight limits',
  },
];

/** Resolution caps offered in the UI — the number is the max *shorter* side. */
export const RESOLUTION_CAPS: { label: string; value: ResolutionCap }[] = [
  { label: 'Original', value: null },
  { label: '2160p (4K)', value: 2160 },
  { label: '1440p', value: 1440 },
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
  { label: '360p', value: 360 },
];

export const FPS_CAPS: { label: string; value: number | null }[] = [
  { label: 'Original', value: null },
  { label: '30 fps', value: 30 },
  { label: '24 fps', value: 24 },
  { label: '15 fps', value: 15 },
];

const MIN_VIDEO_BITRATE = 200_000;
const MAX_VIDEO_BITRATE = 24_000_000;
/** fps assumed when budgeting an uncapped clip. */
const BUDGET_FPS = 30;
/** Rough muxing/overhead fudge factor on the pure a/v payload. */
const CONTAINER_OVERHEAD = 1.02;

export function presetById(id: QualityId): QualityPreset {
  return QUALITY_PRESETS.find((p) => p.id === id) ?? QUALITY_PRESETS[1];
}

/** Round to the nearest even integer (H.264 needs even dimensions), min 2. */
export function clampEven(n: number): number {
  const r = Math.round(n / 2) * 2;
  return Math.max(2, r);
}

/**
 * Downscale-only target dimensions. `capShort` limits the shorter side; the
 * aspect ratio is preserved and the source is never upscaled.
 */
export function computeTargetDimensions(
  srcW: number,
  srcH: number,
  capShort: ResolutionCap,
): TargetDimensions {
  const w = Math.max(2, Math.round(srcW));
  const h = Math.max(2, Math.round(srcH));
  if (!capShort || capShort <= 0) {
    return { width: clampEven(w), height: clampEven(h), scaled: false };
  }
  const shortSide = Math.min(w, h);
  if (capShort >= shortSide) {
    // Cap is larger than the source — don't upscale.
    return { width: clampEven(w), height: clampEven(h), scaled: false };
  }
  const scale = capShort / shortSide;
  return {
    width: clampEven(w * scale),
    height: clampEven(h * scale),
    scaled: true,
  };
}

/** fps used for both budgeting and (when capped) the actual encode. */
export function effectiveFps(fpsCap: number | null): number {
  return fpsCap && fpsCap > 0 ? fpsCap : BUDGET_FPS;
}

/** Target video bitrate (bits/s) from pixel count, fps and the quality bpp. */
export function estimateVideoBitrate(
  width: number,
  height: number,
  fps: number,
  bpp: number,
): number {
  const raw = width * height * fps * bpp;
  const clamped = Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, raw));
  return Math.round(clamped);
}

/** Estimated output size in bytes for a given payload bitrate and duration. */
export function estimateSizeBytes(
  videoBitrate: number,
  audioBitrate: number,
  durationSec: number,
  keepAudio: boolean,
): number {
  const dur = Math.max(0, durationSec);
  const bits = (videoBitrate + (keepAudio ? audioBitrate : 0)) * dur;
  return Math.round((bits / 8) * CONTAINER_OVERHEAD);
}

/** Clamp a trim range to [0, duration] with start < end. */
export function normalizeTrim(
  start: number,
  end: number,
  durationSec: number,
): { start: number; end: number } {
  const d = Math.max(0, durationSec);
  let s = Math.min(Math.max(0, start), d);
  let e = Math.min(Math.max(0, end), d);
  if (e <= s) e = d;
  if (s >= e) s = 0;
  return { start: s, end: e };
}

/** Effective (trimmed) duration in seconds. */
export function trimmedDuration(settings: Settings, probe: ProbeResult): number {
  const { start, end } = normalizeTrim(settings.trimStart, settings.trimEnd, probe.durationSec);
  return Math.max(0, end - start);
}

/**
 * Resolve UI settings + probe into the concrete parameters the worker needs,
 * plus the estimated output size. Single source of truth for both.
 */
export function resolveConversion(
  settings: Settings,
  probe: ProbeResult,
): { params: ConvertParams; estimatedBytes: number; target: TargetDimensions } {
  const preset = presetById(settings.quality);
  const target = computeTargetDimensions(probe.width, probe.height, settings.resolutionCap);
  const fps = effectiveFps(settings.fpsCap);
  const videoBitrate = estimateVideoBitrate(target.width, target.height, fps, preset.bpp);
  const { start, end } = normalizeTrim(settings.trimStart, settings.trimEnd, probe.durationSec);
  const dur = Math.max(0, end - start);
  const keepAudio = settings.keepAudio && probe.hasAudio;

  const applyTrim = start > 0.02 || end < probe.durationSec - 0.02;

  const params: ConvertParams = {
    videoBitrate,
    frameRate: settings.fpsCap ?? undefined,
    keepAudio,
    hasAudio: probe.hasAudio,
    audioBitrate: preset.audioBitrate,
    applyTrim,
    trimStart: start,
    trimEnd: end,
    durationSec: dur,
  };
  if (target.scaled) {
    params.width = target.width;
    params.height = target.height;
  }

  const estimatedBytes = estimateSizeBytes(videoBitrate, preset.audioBitrate, dur, keepAudio);
  return { params, estimatedBytes, target };
}

/** Percent size reduction from original → output (negative if it grew). */
export function percentSaved(originalBytes: number, newBytes: number): number {
  if (originalBytes <= 0) return 0;
  return Math.round((1 - newBytes / originalBytes) * 100);
}
