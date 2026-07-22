// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/** Formatting helpers — pure and unit-tested. */

/** Human byte size: "0 B", "1.5 KB", "5.0 MB", "3.0 GB". Drops decimals ≥ 100. */
export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let u = 0;
  let n = bytes;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  if (u === 0) return `${Math.round(n)} B`;
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}

/** Clock time for handles/scrubber: "0:00.0", "1:05.3", "1:02:03.0". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const tenths = Math.floor((s * 10) % 10);
  const p = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${p(mins)}:${p(secs)}.${tenths}`;
  return `${mins}:${p(secs)}.${tenths}`;
}

/** Coarser duration for labels: "0:00", "1:15", "1:01:01". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, isFinite(seconds) ? Math.floor(seconds) : 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${p(mins)}:${p(secs)}`;
  return `${mins}:${p(secs)}`;
}

/** Human bitrate: "1.2 Mbps", "640 kbps". */
export function formatBitrate(bitsPerSecond: number): string {
  if (!isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '0 kbps';
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

/** Strip a file extension and any path, keep a readable stem. */
export function baseName(name: string): string {
  const noPath = name.split(/[\\/]/).pop() ?? name;
  const dot = noPath.lastIndexOf('.');
  return dot > 0 ? noPath.slice(0, dot) : noPath;
}

/** Filesystem-safe slug for a filename stem. */
export function sanitizeStem(stem: string): string {
  const cleaned = stem
    .trim()
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'video';
}

/** e.g. "clip-vidwell.mp4" from a source name. */
export function buildOutputFilename(sourceName: string): string {
  return `${sanitizeStem(baseName(sourceName))}-vidwell.mp4`;
}
