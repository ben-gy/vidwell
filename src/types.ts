// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** Shared types for Vidwell. */

export type QualityId = 'high' | 'balanced' | 'small' | 'tiny';

/** A resolution cap expressed as the max length of the *shorter* side (px), or null = source. */
export type ResolutionCap = number | null;

/** A frame-rate cap in fps, or null = source. */
export type FpsCap = number | null;

export interface QualityPreset {
  id: QualityId;
  label: string;
  /** Bits per pixel-frame — the size/quality knob. */
  bpp: number;
  /** Target AAC audio bitrate (bits/s). */
  audioBitrate: number;
  desc: string;
}

/** User-chosen settings, held in the UI. */
export interface Settings {
  quality: QualityId;
  resolutionCap: ResolutionCap;
  fpsCap: FpsCap;
  keepAudio: boolean;
  /** Trim in/out in seconds. */
  trimStart: number;
  trimEnd: number;
}

/** What we learn about the source before configuring. */
export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  canDecodeVideo: boolean;
  container: string;
}

/** Concrete, resolved parameters handed to the worker. */
export interface ConvertParams {
  videoBitrate: number;
  /** Only set when downscaling; omitted keeps the source size. */
  width?: number;
  height?: number;
  frameRate?: number;
  keepAudio: boolean;
  hasAudio: boolean;
  audioBitrate: number;
  /** Whether the trim range is a real subrange of the source. */
  applyTrim: boolean;
  trimStart: number;
  trimEnd: number;
  durationSec: number;
}

export type WorkerRequest =
  | { type: 'convert'; file: File; params: ConvertParams }
  | { type: 'cancel' };

export type WorkerResponse =
  | { type: 'started' }
  | { type: 'progress'; progress: number }
  | { type: 'done'; buffer: ArrayBuffer; size: number }
  | { type: 'invalid'; reason: string }
  | { type: 'error'; message: string };

/** Dimensions after applying a resolution cap. */
export interface TargetDimensions {
  width: number;
  height: number;
  scaled: boolean;
}
