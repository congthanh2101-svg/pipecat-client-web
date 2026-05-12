export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, v);
  }
  for (const child of children) {
    e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return e;
}

export function qs<T = HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el as unknown as T;
}

export function setText(selector: string, text: string): void {
  const e = document.querySelector(selector);
  if (e) e.textContent = text;
}

export function setHTML(selector: string, html: string): void {
  const e = document.querySelector(selector);
  if (e) e.innerHTML = html;
}

export function setStatus(state: string, color: string): void {
  const indicator = document.querySelector('#status-indicator');
  const text = document.querySelector('#status-text');
  if (indicator) indicator.setAttribute('class', `status-dot status-${color}`);
  if (text) text.textContent = state;
}

export function addTranscriptEntry(who: string, text: string): void {
  const container = document.querySelector('#transcript');
  if (!container) return;
  const entry = el('div', { class: `transcript-entry transcript-${who}` },
    el('span', { class: 'transcript-label' }, who === 'user' ? 'You' : 'Bot'),
    el('span', { class: 'transcript-text' }, text)
  );
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

export function toggleConnectButton(connected: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-connect');
  if (!btn) return;
  btn.textContent = connected ? 'Disconnect' : 'Connect';
  btn.className = connected ? 'btn btn-disconnect' : 'btn btn-connect';
}

export function setInputsEnabled(enabled: boolean): void {
  const phone = document.querySelector<HTMLInputElement>('#phone-input');
  if (phone) phone.disabled = !enabled;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
