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
    version: "1.0.0",
    about: {
      library: "pipecat-client-web",
      library_version: "1.0.0",
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
