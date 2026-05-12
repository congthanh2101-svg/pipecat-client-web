/**
 * Binary message encoding for Pipecat RTVI protocol.
 *
 * Message format: [0x22] [outer_len: varint] [0x0A] [json_len: varint] [JSON payload]
 */

function encodeVarint(value: number): number[] {
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
  const msg = new Uint8Array(
    1 + outerLenVarint.length + 1 + innerLenVarint.length + jsonLen
  );
  let offset = 0;
  msg[offset++] = 0x22;
  outerLenVarint.forEach((b) => (msg[offset++] = b));
  msg[offset++] = 0x0a;
  innerLenVarint.forEach((b) => (msg[offset++] = b));
  msg.set(jsonBytes, offset);
  return msg.buffer;
}
