/**
 * Binary message decoding for Pipecat RTVI protocol.
 *
 * Message format: [0x22] [outer_len: varint] [0x0A] [json_len: varint] [JSON payload]
 */

export function decodeMessage(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let offset = 1;
  while (bytes[offset] & 128) offset++;
  offset++;
  if (bytes[offset] !== 0x0a) throw new Error('Invalid message format');
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

/**
 * Check if an ArrayBuffer looks like a protobuf-encoded message
 * (starts with 0x22 byte)
 */
export function isEncodedMessage(data: ArrayBuffer): boolean {
  if (data.byteLength === 0) return false;
  return new Uint8Array(data)[0] === 0x22;
}
