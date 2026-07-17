import { describe, expect, it } from 'vitest';
import {
  QUALITY_PRESETS,
  clampEven,
  computeTargetDimensions,
  effectiveFps,
  estimateSizeBytes,
  estimateVideoBitrate,
  normalizeTrim,
  percentSaved,
  presetById,
  resolveConversion,
  trimmedDuration,
} from '../src/compress';
import type { ProbeResult, Settings } from '../src/types';

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  durationSec: 60,
  width: 1920,
  height: 1080,
  videoCodec: 'avc',
  audioCodec: 'aac',
  hasAudio: true,
  canDecodeVideo: true,
  container: 'MP4',
  ...over,
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  quality: 'balanced',
  resolutionCap: null,
  fpsCap: null,
  keepAudio: true,
  trimStart: 0,
  trimEnd: 60,
  ...over,
});

describe('clampEven', () => {
  it('rounds to nearest even', () => {
    expect(clampEven(101)).toBe(102);
    expect(clampEven(103)).toBe(104);
    expect(clampEven(100)).toBe(100);
    expect(clampEven(99)).toBe(100);
  });
  it('never returns below 2', () => {
    expect(clampEven(0)).toBe(2);
    expect(clampEven(1)).toBe(2);
    expect(clampEven(-50)).toBe(2);
  });
});

describe('computeTargetDimensions', () => {
  it('keeps source when cap is null', () => {
    const d = computeTargetDimensions(1920, 1080, null);
    expect(d).toEqual({ width: 1920, height: 1080, scaled: false });
  });
  it('downscales landscape by shorter side', () => {
    const d = computeTargetDimensions(1920, 1080, 720);
    expect(d.height).toBe(720);
    expect(d.width).toBe(1280);
    expect(d.scaled).toBe(true);
  });
  it('downscales portrait by shorter side (width)', () => {
    const d = computeTargetDimensions(1080, 1920, 720);
    expect(d.width).toBe(720);
    expect(d.height).toBe(1280);
    expect(d.scaled).toBe(true);
  });
  it('never upscales when cap exceeds source', () => {
    const d = computeTargetDimensions(640, 480, 1080);
    expect(d).toEqual({ width: 640, height: 480, scaled: false });
  });
  it('produces even dimensions', () => {
    const d = computeTargetDimensions(1921, 1081, 721);
    expect(d.width % 2).toBe(0);
    expect(d.height % 2).toBe(0);
  });
  it('handles tiny/degenerate input without going below 2', () => {
    const d = computeTargetDimensions(1, 1, 360);
    expect(d.width).toBeGreaterThanOrEqual(2);
    expect(d.height).toBeGreaterThanOrEqual(2);
  });
});

describe('effectiveFps', () => {
  it('uses the cap when set', () => {
    expect(effectiveFps(24)).toBe(24);
  });
  it('defaults to 30 when uncapped or invalid', () => {
    expect(effectiveFps(null)).toBe(30);
    expect(effectiveFps(0)).toBe(30);
  });
});

describe('estimateVideoBitrate', () => {
  it('scales with pixels, fps and bpp', () => {
    const a = estimateVideoBitrate(1280, 720, 30, 0.06);
    const b = estimateVideoBitrate(640, 360, 30, 0.06);
    expect(a).toBeGreaterThan(b);
  });
  it('clamps to a sane minimum', () => {
    expect(estimateVideoBitrate(64, 64, 1, 0.02)).toBeGreaterThanOrEqual(200_000);
  });
  it('clamps to a sane maximum', () => {
    expect(estimateVideoBitrate(7680, 4320, 60, 0.2)).toBeLessThanOrEqual(24_000_000);
  });
});

describe('estimateSizeBytes', () => {
  it('adds audio only when kept', () => {
    const withAudio = estimateSizeBytes(1_000_000, 128_000, 60, true);
    const without = estimateSizeBytes(1_000_000, 128_000, 60, false);
    expect(withAudio).toBeGreaterThan(without);
  });
  it('is zero for zero duration', () => {
    expect(estimateSizeBytes(1_000_000, 128_000, 0, true)).toBe(0);
  });
  it('roughly matches bitrate*duration/8', () => {
    // 1 Mbps video, no audio, 8s → ~1 MB payload
    const bytes = estimateSizeBytes(1_000_000, 0, 8, false);
    expect(bytes).toBeGreaterThan(950_000);
    expect(bytes).toBeLessThan(1_100_000);
  });
});

describe('normalizeTrim', () => {
  it('clamps to bounds', () => {
    expect(normalizeTrim(-5, 999, 60)).toEqual({ start: 0, end: 60 });
  });
  it('fixes an inverted range by extending to the end', () => {
    const r = normalizeTrim(40, 20, 60);
    expect(r.start).toBe(40);
    expect(r.end).toBe(60);
  });
  it('preserves a valid subrange', () => {
    expect(normalizeTrim(10, 25, 60)).toEqual({ start: 10, end: 25 });
  });
});

describe('trimmedDuration', () => {
  it('computes the kept length', () => {
    expect(trimmedDuration(settings({ trimStart: 10, trimEnd: 25 }), probe())).toBe(15);
  });
});

describe('resolveConversion', () => {
  it('omits width/height when not downscaling', () => {
    const { params, target } = resolveConversion(settings(), probe());
    expect(target.scaled).toBe(false);
    expect(params.width).toBeUndefined();
    expect(params.height).toBeUndefined();
  });
  it('sets width/height when downscaling', () => {
    const { params } = resolveConversion(settings({ resolutionCap: 720 }), probe());
    expect(params.width).toBe(1280);
    expect(params.height).toBe(720);
  });
  it('drops audio when keepAudio is false', () => {
    const { params } = resolveConversion(settings({ keepAudio: false }), probe());
    expect(params.keepAudio).toBe(false);
  });
  it('forces keepAudio off when the source has no audio', () => {
    const { params } = resolveConversion(settings({ keepAudio: true }), probe({ hasAudio: false }));
    expect(params.keepAudio).toBe(false);
  });
  it('flags applyTrim only for a real subrange', () => {
    expect(resolveConversion(settings(), probe()).params.applyTrim).toBe(false);
    expect(resolveConversion(settings({ trimStart: 5 }), probe()).params.applyTrim).toBe(true);
    expect(resolveConversion(settings({ trimEnd: 40 }), probe()).params.applyTrim).toBe(true);
  });
  it('carries the frame-rate cap through', () => {
    expect(resolveConversion(settings({ fpsCap: 24 }), probe()).params.frameRate).toBe(24);
    expect(resolveConversion(settings(), probe()).params.frameRate).toBeUndefined();
  });
  it('lowers the estimate for a lower quality preset', () => {
    const hi = resolveConversion(settings({ quality: 'high' }), probe()).estimatedBytes;
    const lo = resolveConversion(settings({ quality: 'tiny' }), probe()).estimatedBytes;
    expect(lo).toBeLessThan(hi);
  });
});

describe('presetById', () => {
  it('returns the matching preset', () => {
    expect(presetById('tiny').id).toBe('tiny');
  });
  it('falls back to balanced for an unknown id', () => {
    // @ts-expect-error deliberately invalid
    expect(presetById('bogus').id).toBe('balanced');
  });
  it('exposes four presets in descending bpp order', () => {
    expect(QUALITY_PRESETS).toHaveLength(4);
    for (let i = 1; i < QUALITY_PRESETS.length; i++) {
      expect(QUALITY_PRESETS[i].bpp).toBeLessThan(QUALITY_PRESETS[i - 1].bpp);
    }
  });
});

describe('percentSaved', () => {
  it('reports positive savings', () => {
    expect(percentSaved(100, 40)).toBe(60);
  });
  it('reports negative when the file grew', () => {
    expect(percentSaved(100, 120)).toBe(-20);
  });
  it('is zero for an invalid original', () => {
    expect(percentSaved(0, 40)).toBe(0);
  });
});
