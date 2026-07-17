/**
 * Metadata probing + capability detection. Runs on the main thread using
 * mediabunny's lazy reader (only the header bytes are read), so the UI can be
 * populated immediately after a file is picked.
 */

import { ALL_FORMATS, BlobSource, Input, getFirstEncodableVideoCodec } from 'mediabunny';
import type { ProbeResult } from './types';

/** Best-effort container label from the file name / MIME. */
function containerLabel(file: File): string {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (ext) return ext.toUpperCase();
  const t = file.type.split('/').pop();
  return t ? t.toUpperCase() : 'VIDEO';
}

export class NoVideoTrackError extends Error {}

export async function probeVideo(file: File): Promise<ProbeResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new NoVideoTrackError('This file has no video track Vidwell can read.');
  }

  const [durationSec, width, height, videoCodec, canDecodeVideo] = await Promise.all([
    input.computeDuration().catch(() => 0),
    videoTrack.getDisplayWidth().catch(() => 0),
    videoTrack.getDisplayHeight().catch(() => 0),
    videoTrack.getCodec().catch(() => null),
    videoTrack.canDecode().catch(() => false),
  ]);

  let audioCodec: string | null = null;
  let hasAudio = false;
  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack) {
      hasAudio = true;
      audioCodec = await audioTrack.getCodec().catch(() => null);
    }
  } catch {
    /* no audio track */
  }

  return {
    durationSec: durationSec || 0,
    width: width || 0,
    height: height || 0,
    videoCodec: videoCodec ?? null,
    audioCodec,
    hasAudio,
    canDecodeVideo,
    container: containerLabel(file),
  };
}

/** Does this browser expose WebCodecs at all? */
export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

/** Can we encode H.264? Unknown/throwing → optimistic (let the user try). */
export async function canEncodeH264(): Promise<boolean> {
  if (!hasWebCodecs()) return false;
  try {
    const codec = await getFirstEncodableVideoCodec(['avc']);
    return codec !== null && codec !== undefined;
  } catch {
    return true;
  }
}
