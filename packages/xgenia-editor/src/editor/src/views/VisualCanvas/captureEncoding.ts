/**
 * How a preview capture is encoded for the requester.
 *
 * (2026-10-07, export 1791403496006) capture_motion's whole-page layer took 5.4–6.9 s PER FRAME: every
 * frame is a ~1820x1024 PNG, encoded twice and sent as base64 over the AI's bridge. A 2.4 s effect came
 * back as frames 48 s apart. A motion frame does not need lossless pixels; a requester may now ask for
 * JPEG. No options (every existing caller) keeps the PNG it always got.
 */
export interface CaptureEncodingRequest {
  format?: 'png' | 'jpeg';
  /** 1–100, as an image quality setting reads. */
  quality?: number;
}

export function captureEncoding(req: unknown): { mime?: string; quality?: number } {
  const r = (req && typeof req === 'object' ? req : {}) as CaptureEncodingRequest;
  if (r.format !== 'jpeg') return {};
  const q = Number.isFinite(Number(r.quality)) ? Number(r.quality) : 70;
  return { mime: 'image/jpeg', quality: Math.min(95, Math.max(30, q)) / 100 };
}
