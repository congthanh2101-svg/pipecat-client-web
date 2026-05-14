export function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 127) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  bytes.push(value & 127);
  return bytes;
}

export function encodeMessage(jsonStr: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(jsonStr);
  const jsonLen = jsonBytes.length;
  const innerLenVarint = encodeVarint(jsonLen);
  const outerLen = 1 + innerLenVarint.length + jsonLen;
  const outerLenVarint = encodeVarint(outerLen);
  const msg = new Uint8Array(1 + outerLenVarint.length + 1 + innerLenVarint.length + jsonLen);
  let offset = 0;
  msg[offset++] = 0x22;
  for (const b of outerLenVarint) msg[offset++] = b;
  msg[offset++] = 0x0A;
  for (const b of innerLenVarint) msg[offset++] = b;
  msg.set(jsonBytes, offset);
  return msg.buffer;
}

export function decodeMessage(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let offset = 1; // skip 0x22
  while (bytes[offset] & 128) offset++;
  offset++;
  if (bytes[offset] !== 0x0A) throw new Error('Invalid message: missing 0x0A marker');
  offset++;
  let jsonLen = 0;
  let shift = 0;
  while (bytes[offset] & 128) {
    jsonLen |= (bytes[offset] & 127) << shift;
    shift += 7;
    offset++;
  }
  jsonLen |= (bytes[offset] & 127) << shift;
  offset++;
  return new TextDecoder().decode(bytes.subarray(offset, offset + jsonLen));
}

export function createRTVIMessage(type: string, data: unknown, label = "rtvi-ai"): string {
  const id = crypto.randomUUID().slice(0, 8);
  return JSON.stringify({ label, type, data, id });
}

export function createClientReady(): string {
  const browser = navigator.userAgent.includes("Chrome") ? "Chrome"
    : navigator.userAgent.includes("Firefox") ? "Firefox"
    : navigator.userAgent.includes("Edge") ? "Edge"
    : "Other";
  return createRTVIMessage("client-ready", {
    version: "1.3.0",
    about: {
      library: "pipecat-client-web",
      library_version: "1.3.0",
      platform_details: {
        browser,
        platform_type: "desktop"
      }
    }
  });
}

export function parseRTVIResponse(jsonStr: string): { label: string; type: string; data: unknown; id?: string } {
  return JSON.parse(jsonStr);
}

// ---------------------------------------------------------------------------
// Protobuf AudioRawFrame helpers (bridge server protocol)
// ---------------------------------------------------------------------------
// Frame format:
//   Frame { 2: AudioRawFrame { 3: audio (Int16 bytes), 4: sample_rate, 5: num_channels } }
//   MessageFrame (field 4) happens to have same byte layout as RTVI 0x22

/** Check if data is a protobuf AudioRawFrame (starts with 0x12). */
export function isAudioFrame(data: ArrayBuffer): boolean {
  if (data.byteLength === 0) return false;
  return new Uint8Array(data)[0] === 0x12;
}

/**
 * Wrap Int16 PCM bytes in a protobuf AudioRawFrame.
 * Frame { 2: AudioRawFrame { 3: audio, 4: sample_rate, 5: num_channels } }
 */
export function encodeAudioFrame(
  int16Bytes: Uint8Array,
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  const srVarint = encodeVarint(sampleRate);
  const ncVarint = encodeVarint(numChannels);
  const audioLenVarint = encodeVarint(int16Bytes.length);

  const innerLen =
    1 + audioLenVarint.length + int16Bytes.length +
    1 + srVarint.length +
    1 + ncVarint.length;

  const inner = new Uint8Array(innerLen);
  let off = 0;
  inner[off++] = 0x1a; // field 3, wire type 2
  audioLenVarint.forEach((b) => (inner[off++] = b));
  inner.set(int16Bytes, off);
  off += int16Bytes.length;
  inner[off++] = 0x20; // field 4, wire type 0
  srVarint.forEach((b) => (inner[off++] = b));
  inner[off++] = 0x28; // field 5, wire type 0
  ncVarint.forEach((b) => (inner[off++] = b));

  const innerLenVarint = encodeVarint(inner.length);
  const frame = new Uint8Array(1 + innerLenVarint.length + inner.length);
  off = 0;
  frame[off++] = 0x12; // field 2, wire type 2
  innerLenVarint.forEach((b) => (frame[off++] = b));
  frame.set(inner, off);
  return frame.buffer;
}

/**
 * Parse a protobuf AudioRawFrame.
 */
export function decodeAudioFrame(data: ArrayBuffer): {
  int16Bytes: Uint8Array | null;
  sampleRate: number;
  numChannels: number;
} {
  const bytes = new Uint8Array(data);
  let pos = 0;
  if (bytes[pos] !== 0x12) return { int16Bytes: null, sampleRate: 16000, numChannels: 1 };
  pos++;

  let subLen = 0, shift = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    subLen |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  const subEnd = pos + subLen;

  let int16Bytes: Uint8Array | null = null;
  let sampleRate = 16000;
  let numChannels = 1;

  while (pos < subEnd) {
    const tag = bytes[pos++];
    const fieldNum = tag >> 3;
    const wireType = tag & 7;

    if (fieldNum === 3 && wireType === 2) {
      let len = 0; shift = 0;
      while (pos < subEnd) {
        const b = bytes[pos++];
        len |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      int16Bytes = bytes.slice(pos, pos + len);
      pos += len;
    } else if (fieldNum === 4 && wireType === 0) {
      let val = 0; shift = 0;
      while (pos < subEnd) {
        const b = bytes[pos++];
        val |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      sampleRate = val;
    } else if (fieldNum === 5 && wireType === 0) {
      let val = 0; shift = 0;
      while (pos < subEnd) {
        const b = bytes[pos++];
        val |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      numChannels = val;
    } else {
      if (wireType === 0) {
        while (pos < subEnd && (bytes[pos] & 0x80)) pos++;
        pos++;
      } else if (wireType === 2) {
        let len = 0; shift = 0;
        while (pos < subEnd) {
          const b = bytes[pos++];
          len |= (b & 0x7f) << shift;
          shift += 7;
          if (!(b & 0x80)) break;
        }
        pos += len;
      } else {
        break;
      }
    }
  }
  return { int16Bytes, sampleRate, numChannels };
}

import type { AudioFormatType } from './settings.js';

// ---------------------------------------------------------------------------
// Audio format encoding helpers (for configurable Settings)
// ---------------------------------------------------------------------------

/** Convert Float32 to raw Int16 PCM ArrayBuffer (no protobuf wrapper). */
export function encodeRawInt16(input: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16.buffer as ArrayBuffer;
}

/** Return raw Float32 PCM ArrayBuffer (pass-through). */
export function encodeRawFloat32(input: Float32Array): ArrayBuffer {
  return input.buffer as ArrayBuffer;
}

/**
 * Encode audio in the specified format.
 * Used by AudioManager to dispatch based on current settings.
 */
export function encodeAudioForFormat(
  input: Float32Array,
  format: AudioFormatType,
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  switch (format) {
    case 'protobuf-int16': {
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return encodeAudioFrame(
        new Uint8Array(int16.buffer as ArrayBuffer),
        sampleRate,
        numChannels
      );
    }
    case 'raw-int16':
      return encodeRawInt16(input);
    case 'raw-float32':
      return encodeRawFloat32(input);
  }
}

/** Convert Int16 PCM bytes to Float32 for playback. */
export function int16ToFloat32(uint8Bytes: Uint8Array): Float32Array {
  const int16 = new Int16Array(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.length >> 1);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    out[i] = int16[i] / 32768;
  }
  return out;
}
