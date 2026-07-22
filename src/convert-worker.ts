// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Conversion worker — owns a mediabunny `Conversion` and streams progress.
 * Everything heavy (decode → scale → H.264 encode → MP4 mux) happens here so
 * the main thread and its progress bar stay responsive.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import type { ConvertParams, WorkerRequest, WorkerResponse } from './types';

// Polyfill AAC encoding for browsers whose WebCodecs lacks it (needed when a
// non-MP4 input's audio must be re-encoded to fit an MP4). Registration is
// synchronous and lazy — the WASM only loads on first use. Guarded so a failure
// leaves the native-AAC / stream-copy paths working.
try {
  registerAacEncoder();
} catch {
  /* fall back to native AAC or stream-copy */
}

let current: Conversion | null = null;

function post(m: WorkerResponse, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(m, transfer ?? []);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    if (current) {
      try {
        await current.cancel();
      } catch {
        /* already finishing */
      }
    }
    return;
  }
  if (msg.type !== 'convert') return;

  try {
    await run(msg.file, msg.params);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    current = null;
  }
};

async function run(file: File, p: ConvertParams): Promise<void> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  const video: Record<string, unknown> = { codec: 'avc', bitrate: p.videoBitrate };
  if (p.width && p.height) {
    video.width = p.width;
    video.height = p.height;
    // Target dims are computed from the source aspect ratio, so 'fill' resizes
    // exactly without letterbox bars. mediabunny requires `fit` when both are set.
    video.fit = 'fill';
  }
  if (p.frameRate) video.frameRate = p.frameRate;

  const audio: Record<string, unknown> =
    p.keepAudio && p.hasAudio
      ? { codec: 'aac', bitrate: p.audioBitrate }
      : { discard: true };

  const init: Record<string, unknown> = { input, output, video, audio };
  if (p.applyTrim) {
    init.trim = { start: p.trimStart, end: p.trimEnd };
  }

  const conversion = await Conversion.init(init as never);
  current = conversion;

  if (!conversion.isValid) {
    const reasons = (conversion.discardedTracks ?? [])
      .map((d: { reason?: string }) => d.reason)
      .filter(Boolean)
      .join(', ');
    post({
      type: 'invalid',
      reason:
        reasons ||
        'This video could not be prepared for compression in your browser.',
    });
    return;
  }

  conversion.onProgress = (progress: number) => {
    post({ type: 'progress', progress });
  };

  post({ type: 'started' });
  await conversion.execute();

  const raw = output.target.buffer as ArrayBuffer | ArrayBufferView | null;
  if (!raw) {
    post({ type: 'error', message: 'The encoder produced no output.' });
    return;
  }
  let ab: ArrayBuffer;
  if (raw instanceof ArrayBuffer) {
    ab = raw;
  } else {
    // Copy any view into a fresh, non-shared ArrayBuffer we can transfer.
    const view = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    ab = copy.buffer;
  }

  post({ type: 'done', buffer: ab, size: ab.byteLength }, [ab]);
}
