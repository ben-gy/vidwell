import { describe, expect, it } from 'vitest';
import {
  baseName,
  buildOutputFilename,
  formatBitrate,
  formatBytes,
  formatClock,
  formatDuration,
  sanitizeStem,
} from '../src/format';

describe('formatBytes', () => {
  it('handles zero and negatives', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });
  it('formats across units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('drops decimals at/above 100', () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
  });
});

describe('formatClock', () => {
  it('shows tenths', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(65.3)).toBe('1:05.3');
  });
  it('adds hours when needed', () => {
    expect(formatClock(3723)).toBe('1:02:03.0');
  });
  it('guards against NaN/negatives', () => {
    expect(formatClock(NaN)).toBe('0:00.0');
    expect(formatClock(-5)).toBe('0:00.0');
  });
});

describe('formatDuration', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('formatBitrate', () => {
  it('uses kbps below 1 Mbps', () => {
    expect(formatBitrate(640_000)).toBe('640 kbps');
  });
  it('uses Mbps at/above 1 Mbps', () => {
    expect(formatBitrate(2_500_000)).toBe('2.5 Mbps');
  });
  it('handles zero', () => {
    expect(formatBitrate(0)).toBe('0 kbps');
  });
});

describe('baseName / sanitizeStem', () => {
  it('strips path and extension', () => {
    expect(baseName('/a/b/clip.final.mp4')).toBe('clip.final');
    expect(baseName('movie')).toBe('movie');
  });
  it('sanitizes to a safe stem', () => {
    expect(sanitizeStem('My Holiday! Clip')).toBe('My-Holiday-Clip');
    expect(sanitizeStem('   ')).toBe('video');
  });
});

describe('buildOutputFilename', () => {
  it('appends -vidwell.mp4', () => {
    expect(buildOutputFilename('IMG_1234.MOV')).toBe('IMG_1234-vidwell.mp4');
  });
  it('handles names with spaces and odd characters', () => {
    expect(buildOutputFilename('beach day (4k).mkv')).toBe('beach-day-4k-vidwell.mp4');
  });
});
