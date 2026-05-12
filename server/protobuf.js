/**
 * Pipecat Protobuf Frame helpers
 *
 * Handles protobuf serialization/deserialization for Pipecat frames
 * using @bufbuild/protobuf v2 BinaryWriter/BinaryReader.
 *
 * Frame schema:
 *   Frame (oneof):
 *     1: TextFrame
 *     2: AudioRawFrame  <-- audio data
 *     3: TranscriptionFrame
 *     4: MessageFrame   <-- RTVI JSON messages
 *
 * AudioRawFrame:
 *   1: id (uint64)
 *   2: name (string)
 *   3: audio (bytes)  <-- Int16Array PCM
 *   4: sample_rate (uint32)
 *   5: num_channels (uint32)
 *   6: pts (optional uint64)
 *
 * MessageFrame:
 *   1: data (string)  <-- JSON string
 */

const { BinaryWriter, BinaryReader, WireType } = require('@bufbuild/protobuf/wire');

/**
 * Parse an incoming protobuf Frame and return its type and data.
 * @param {Uint8Array} buffer
 * @returns {{ type: string|null, data: object|null }}
 */
function parseFrame(buffer) {
  const reader = new BinaryReader(buffer);
  let frameType = null;
  let frameData = null;

  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 2) {
      // AudioRawFrame
      const subBytes = reader.bytes();
      frameType = 'audio';
      frameData = parseAudioFrame(subBytes);
    } else if (fieldNo === 4) {
      // MessageFrame
      const subBytes = reader.bytes();
      frameType = 'message';
      frameData = parseMessageFrame(subBytes);
    } else {
      reader.skip(wireType);
    }
  }

  return { type: frameType, data: frameData };
}

/**
 * Parse an AudioRawFrame sub-message.
 * @param {Uint8Array} buffer
 * @returns {{ audio: Uint8Array|null, sampleRate: number, numChannels: number }}
 */
function parseAudioFrame(buffer) {
  const reader = new BinaryReader(buffer);
  let audio = null;
  let sampleRate = 16000;
  let numChannels = 1;

  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    switch (fieldNo) {
      case 1: reader.uint64(); break;  // id
      case 2: reader.string(); break;  // name
      case 3: audio = reader.bytes(); break;  // audio bytes (Int16)
      case 4: sampleRate = reader.uint32(); break;
      case 5: numChannels = reader.uint32(); break;
      case 6: reader.uint64(); break;  // pts
      default: reader.skip(wireType);
    }
  }

  return { audio, sampleRate, numChannels };
}

/**
 * Parse a MessageFrame sub-message.
 * @param {Uint8Array} buffer
 * @returns {string} JSON string
 */
function parseMessageFrame(buffer) {
  const reader = new BinaryReader(buffer);
  let data = '';

  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 1) {
      data = reader.string();
    } else {
      reader.skip(wireType);
    }
  }

  return data;
}

/**
 * Encode an AudioRawFrame wrapped in a Frame message.
 * @param {Uint8Array} int16Bytes - PCM Int16 audio data
 * @param {number} sampleRate
 * @param {number} numChannels
 * @returns {Uint8Array} Complete protobuf Frame
 */
function encodeAudioFrame(int16Bytes, sampleRate = 16000, numChannels = 1) {
  const sub = new BinaryWriter();
  sub.tag(3, WireType.LengthDelimited).bytes(int16Bytes);
  sub.tag(4, WireType.Varint).uint32(sampleRate);
  sub.tag(5, WireType.Varint).uint32(numChannels);

  const frame = new BinaryWriter();
  frame.tag(2, WireType.LengthDelimited).bytes(sub.finish());
  return frame.finish();
}

/**
 * Encode a MessageFrame wrapped in a Frame message.
 * @param {string} jsonStr - JSON string to wrap
 * @returns {Uint8Array} Complete protobuf Frame
 */
function encodeMessageFrame(jsonStr) {
  const sub = new BinaryWriter();
  sub.tag(1, WireType.LengthDelimited).string(jsonStr);

  const frame = new BinaryWriter();
  frame.tag(4, WireType.LengthDelimited).bytes(sub.finish());
  return frame.finish();
}

/**
 * Convert Int16 buffer to Float32 buffer.
 * @param {Uint8Array} int16Bytes
 * @returns {Float32Array}
 */
function int16ToFloat32(int16Bytes) {
  if (!int16Bytes) return new Float32Array(0);
  const int16 = new Int16Array(int16Bytes.buffer, int16Bytes.byteOffset, int16Bytes.length / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

/**
 * Convert Float32 buffer to Int16 buffer.
 * @param {Float32Array|ArrayBuffer} float32Data
 * @returns {Uint8Array} Int16 bytes
 */
function float32ToInt16(float32Data) {
  const float32 = float32Data instanceof Float32Array
    ? float32Data
    : new Float32Array(float32Data);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return new Uint8Array(int16.buffer);
}

/**
 * RTVI 0x22 encoding helpers (for backend communication).
 */

function encodeRTVIMessage(jsonStr) {
  const jsonBytes = Buffer.from(jsonStr, 'utf-8');
  const innerLen = jsonBytes.length;

  // inner_len varint
  const innerLenBytes = [];
  let v = innerLen;
  do {
    let b = v & 0x7f;
    v >>= 7;
    if (v > 0) b |= 0x80;
    innerLenBytes.push(b);
  } while (v > 0);

  // outer_len = 1 (0x0A tag) + inner_len_varint_size + inner_len
  const outerLen = 1 + innerLenBytes.length + innerLen;
  const outerLenBytes = [];
  v = outerLen;
  do {
    let b = v & 0x7f;
    v >>= 7;
    if (v > 0) b |= 0x80;
    outerLenBytes.push(b);
  } while (v > 0);

  const totalLen = 1 + outerLenBytes.length + 1 + innerLenBytes.length + innerLen;
  const buf = Buffer.alloc(totalLen);
  let offset = 0;
  buf[offset++] = 0x22;
  for (const b of outerLenBytes) buf[offset++] = b;
  buf[offset++] = 0x0A;
  for (const b of innerLenBytes) buf[offset++] = b;
  buf.set(jsonBytes, offset);
  return buf;
}

/**
 * Decode an RTVI 0x22-encoded message.
 * @param {Buffer} buffer
 * @returns {string} Decoded JSON string
 */
function decodeRTVIMessage(buffer) {
  if (buffer.length < 2 || buffer[0] !== 0x22) {
    throw new Error('Not a valid RTVI message (missing 0x22 tag)');
  }
  let pos = 1;
  // skip outer_len varint
  while (pos < buffer.length && (buffer[pos] & 0x80)) pos++;
  pos++;
  if (pos >= buffer.length || buffer[pos] !== 0x0A) {
    throw new Error('Missing inner tag 0x0A');
  }
  pos++;
  // inner_len varint
  let innerLen = 0, shift = 0;
  while (pos < buffer.length) {
    const b = buffer[pos++];
    innerLen |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  if (pos + innerLen > buffer.length) {
    throw new Error('RTVI message length exceeds buffer');
  }
  return buffer.toString('utf-8', pos, pos + innerLen);
}

/**
 * Check if a buffer starts with the RTVI 0x22 tag.
 */
function isRTVIMessage(buffer) {
  return buffer.length > 0 && buffer[0] === 0x22;
}

module.exports = {
  parseFrame,
  parseAudioFrame,
  parseMessageFrame,
  encodeAudioFrame,
  encodeMessageFrame,
  int16ToFloat32,
  float32ToInt16,
  encodeRTVIMessage,
  decodeRTVIMessage,
  isRTVIMessage,
};
