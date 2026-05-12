export class DebugLogger {
  private container: HTMLElement;
  private entries: string[] = [];
  private maxEntries = 200;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container element #${containerId} not found`);
    this.container = el;
  }

  log(message: string): void {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${hh}:${mm}:${ss}`;
    const entry = `[${timestamp}] ${message}`;
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.render(entry);
  }

  clear(): void {
    this.entries = [];
    this.container.innerHTML = '';
  }

  private render(entry: string): void {
    const line = document.createElement('div');
    line.textContent = entry;
    line.className = 'debug-line';
    this.container.appendChild(line);
    this.container.scrollTop = this.container.scrollHeight;
  }
}
