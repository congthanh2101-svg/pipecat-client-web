import { el, qs } from './ui.js';
import { SettingsManager, type AppSettings } from './settings.js';

type ApplyCallback = (requiresReconnect: boolean) => void;

/**
 * Build the Settings panel card.
 * Returns the container element and control helpers for external wiring.
 */
export function buildSettingsPanel(
  settings: SettingsManager,
  onApply: ApplyCallback
): {
  container: HTMLElement;
  setEnabled: (enabled: boolean) => void;
} {
  const body = buildBody(settings, onApply);

  const container = el(
    'div',
    { class: 'card settings-panel' },
    buildHeader(),
    body
  );

  // Toggle expand/collapse
  const header = qs('.settings-header', container);
  header.addEventListener('click', () => toggleBody(container));

  return {
    container,
    setEnabled: (enabled: boolean) => {
      const selects = container.querySelectorAll<HTMLSelectElement>(
        '.settings-select'
      );
      const inputs = container.querySelectorAll<HTMLInputElement>(
        '.settings-range, .settings-number'
      );
      for (const s of selects) s.disabled = !enabled;
      for (const i of inputs) i.disabled = !enabled;
    },
  };
}

// --------------------------------------------------------------------------
// Header
// --------------------------------------------------------------------------

function buildHeader(): HTMLElement {
  return el(
    'div',
    { class: 'settings-header', id: 'settings-toggle' },
    el('span', { class: 'settings-toggle-icon' }, '▶'),
    el('span', { class: 'card-title', style: 'margin:0;border:none;padding:0;' }, 'Settings'),
    el('span', { class: 'settings-reconnect-hint', style: 'display:none;' }, '(Reconnect required)')
  );
}

// --------------------------------------------------------------------------
// Body
// --------------------------------------------------------------------------

function buildBody(
  settings: SettingsManager,
  onApply: ApplyCallback
): HTMLElement {
  const s = settings.get();

  const body = el('div', { class: 'settings-body', style: 'display:none;' });

  // --- Basic ---
  body.appendChild(el('div', { class: 'settings-section-label' }, 'Basic'));

  // Sample Rate
  body.appendChild(
    buildSelectGroup(
      'setting-sample-rate',
      'Sample Rate',
      s.sampleRate.toString(),
      [
        ['8000', '8000 Hz'],
        ['16000', '16000 Hz'],
        ['22050', '22050 Hz'],
        ['44100', '44100 Hz'],
      ]
    )
  );

  // Mic Constraint
  body.appendChild(
    buildSelectGroup(
      'setting-mic-constraint',
      'Mic Constraint',
      s.micConstraint,
      [
        ['best-stt', 'Best STT quality (default)'],
        ['aggressive-processing', 'Reduced noise/echo (may degrade STT)'],
      ]
    )
  );

  // Audio Format
  body.appendChild(
    buildSelectGroup(
      'setting-audio-format',
      'Audio Format',
      s.audioFormat,
      [
        ['protobuf-int16', 'Protobuf AudioRawFrame + Int16 PCM'],
        ['raw-int16', 'Raw Int16 PCM'],
        ['raw-float32', 'Raw Float32 PCM'],
      ]
    )
  );

  // Server URL
  body.appendChild(
    buildTextGroup(
      'setting-server-url',
      'Pipecat AI Server URL',
      s.serverUrl
    )
  );

  // --- Audio Processing ---
  body.appendChild(el('div', { class: 'settings-section-label', style: 'margin-top:16px;' }, 'Audio Processing'));

  // Audio Processor
  body.appendChild(
    buildSelectGroup(
      'setting-audio-processor',
      'Audio Processor',
      s.audioProcessor,
      [
        ['audio-worklet', 'AudioWorklet (lower latency, Chrome)'],
        ['script-processor', 'ScriptProcessor (fallback)'],
      ]
    )
  );

  // Gain Boost (range slider)
  body.appendChild(buildGainGroup(s.gainBoost));

  // Skip Initial Frames
  body.appendChild(
    buildNumberGroup(
      'setting-skip-frames',
      'Skip Initial Frames',
      s.skipInitialFrames,
      'Frames to discard at capture start (driver noise suppression)',
      0, 200
    )
  );

  // Capture Ramp
  body.appendChild(
    buildSliderGroup(
      'setting-capture-ramp',
      'Capture Gain Ramp',
      s.captureRampMs,
      'ms',
      'Ramp duration when mic starts (0 = instant)',
      0, 500, 10
    )
  );

  // Playback Ramp
  body.appendChild(
    buildSliderGroup(
      'setting-playback-ramp',
      'Playback Gain Ramp',
      s.playbackRampMs,
      'ms',
      'Ramp duration when playback starts (0 = instant)',
      0, 500, 10
    )
  );

  // Fade-In
  body.appendChild(
    buildSliderGroup(
      'setting-fade-in',
      'First Frame Fade-In',
      s.fadeInMs,
      'ms',
      'Fade-in on first buffered audio frame',
      0, 100, 5
    )
  );

  // Action buttons
  const actions = el('div', { class: 'settings-actions' });
  actions.appendChild(
    el('button', { class: 'btn btn-apply', id: 'btn-apply-settings' }, 'Apply')
  );
  actions.appendChild(
    el(
      'button',
      { class: 'btn btn-clear', id: 'btn-reset-settings' },
      'Reset Defaults'
    )
  );
  body.appendChild(actions);

  // --- Event wiring ---

  // Apply button
  qs<HTMLButtonElement>('#btn-apply-settings', body).addEventListener('click', () => {
    const changed = collectChanges(settings, body);
    if (Object.keys(changed).length === 0) return;
    settings.update(changed);
    const needsReconnect = settings.requiresReconnect(changed);
    showReconnectHint(body, needsReconnect);
    onApply(needsReconnect);
  });

  // Reset button
  qs<HTMLButtonElement>('#btn-reset-settings', body).addEventListener('click', () => {
    settings.reset();
    syncControls(settings, body);
    showReconnectHint(body, true);
    onApply(true);
  });

  return body;
}

// --------------------------------------------------------------------------
// Form control builders
// --------------------------------------------------------------------------

function buildSelectGroup(
  id: string,
  label: string,
  selectedValue: string,
  options: [string, string][]
): HTMLElement {
  const group = el('div', { class: 'form-group' });
  group.appendChild(el('label', { for: id }, label));

  const select = el('select', { class: 'settings-select', id });
  for (const [value, text] of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    if (value === selectedValue) opt.selected = true;
    select.appendChild(opt);
  }
  group.appendChild(select);
  return group;
}

function buildGainGroup(currentGain: number): HTMLElement {
  const group = el('div', { class: 'form-group' });
  group.appendChild(
    el('label', { for: 'setting-gain-boost' }, 'Gain Boost: ')
  );
  const valueSpan = el('span', { id: 'gain-boost-value' }, currentGain.toFixed(1));
  group.querySelector('label')!.appendChild(valueSpan);

  const slider = el('input', {
    type: 'range',
    id: 'setting-gain-boost',
    class: 'settings-range',
    min: '0',
    max: '5',
    step: '0.1',
    value: currentGain.toFixed(1),
  }) as HTMLInputElement;

  // Live label update
  slider.addEventListener('input', () => {
    valueSpan.textContent = parseFloat(slider.value).toFixed(1);
  });

  group.appendChild(slider);
  return group;
}

function buildTextGroup(
  id: string,
  label: string,
  value: string
): HTMLElement {
  const group = el('div', { class: 'form-group' });
  group.appendChild(el('label', { for: id }, label));
  const input = el('input', {
    type: 'text',
    id,
    class: 'settings-text',
    value,
  }) as HTMLInputElement;
  group.appendChild(input);
  return group;
}

function buildNumberGroup(
  id: string,
  label: string,
  value: number,
  description: string,
  min: number,
  max: number
): HTMLElement {
  const group = el('div', { class: 'form-group' });
  group.appendChild(el('label', { for: id }, label));
  if (description) {
    group.appendChild(el('div', { class: 'form-description' }, description));
  }
  const input = el('input', {
    type: 'number',
    id,
    class: 'settings-number',
    value: value.toString(),
    min: min.toString(),
    max: max.toString(),
  }) as HTMLInputElement;
  group.appendChild(input);
  return group;
}

function buildSliderGroup(
  id: string,
  label: string,
  value: number,
  unit: string,
  description: string,
  min: number,
  max: number,
  step: number
): HTMLElement {
  const group = el('div', { class: 'form-group' });

  const labelRow = el('div', { class: 'form-label-row' });
  const labelEl = el('label', { for: id }, label);
  const valueLabel = el('span', { class: 'slider-value', id: `${id}-value` }, `${value}${unit}`);
  labelRow.appendChild(labelEl);
  labelRow.appendChild(valueLabel);
  group.appendChild(labelRow);

  if (description) {
    group.appendChild(el('div', { class: 'form-description' }, description));
  }

  const slider = el('input', {
    type: 'range',
    id,
    class: 'settings-range',
    min: min.toString(),
    max: max.toString(),
    step: step.toString(),
    value: value.toString(),
  }) as HTMLInputElement;

  slider.addEventListener('input', () => {
    valueLabel.textContent = `${slider.value}${unit}`;
  });

  group.appendChild(slider);
  return group;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Read all form controls and return only the changed values. */
function collectChanges(
  settings: SettingsManager,
  body: HTMLElement
): Partial<AppSettings> {
  const current = settings.get();
  const changed: Partial<AppSettings> = {};

  const sr = Number(getValue(body, '#setting-sample-rate')) as AppSettings['sampleRate'];
  if (sr !== current.sampleRate) changed.sampleRate = sr;

  const mc = getValue(body, '#setting-mic-constraint') as AppSettings['micConstraint'];
  if (mc !== current.micConstraint) changed.micConstraint = mc;

  const ap = getValue(body, '#setting-audio-processor') as AppSettings['audioProcessor'];
  if (ap !== current.audioProcessor) changed.audioProcessor = ap;

  const gb = parseFloat(getValue(body, '#setting-gain-boost'));
  if (gb !== current.gainBoost) changed.gainBoost = gb;

  const af = getValue(body, '#setting-audio-format') as AppSettings['audioFormat'];
  if (af !== current.audioFormat) changed.audioFormat = af;

  const su = getValue(body, '#setting-server-url');
  if (su !== current.serverUrl) changed.serverUrl = su;

  const sf = Number(getValue(body, '#setting-skip-frames'));
  if (sf !== current.skipInitialFrames) changed.skipInitialFrames = sf;

  const cr = Number(getValue(body, '#setting-capture-ramp'));
  if (cr !== current.captureRampMs) changed.captureRampMs = cr;

  const pr = Number(getValue(body, '#setting-playback-ramp'));
  if (pr !== current.playbackRampMs) changed.playbackRampMs = pr;

  const fi = Number(getValue(body, '#setting-fade-in'));
  if (fi !== current.fadeInMs) changed.fadeInMs = fi;

  return changed;
}

/** Get the value of a form control inside body. */
function getValue(body: HTMLElement, selector: string): string {
  const el = body.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  return el ? el.value : '';
}

/** Sync all form controls to match the SettingsManager state. */
function syncControls(settings: SettingsManager, body: HTMLElement): void {
  const s = settings.get();

  setValue(body, '#setting-sample-rate', s.sampleRate.toString());
  setValue(body, '#setting-mic-constraint', s.micConstraint);
  setValue(body, '#setting-audio-processor', s.audioProcessor);
  setValue(body, '#setting-gain-boost', s.gainBoost.toFixed(1));
  setValue(body, '#setting-audio-format', s.audioFormat);
  setValue(body, '#setting-server-url', s.serverUrl);
  setValue(body, '#setting-skip-frames', s.skipInitialFrames.toString());
  setValue(body, '#setting-capture-ramp', s.captureRampMs.toString());
  setValue(body, '#setting-playback-ramp', s.playbackRampMs.toString());
  setValue(body, '#setting-fade-in', s.fadeInMs.toString());

  // Update slider labels
  const gainLabel = body.querySelector('#gain-boost-value');
  if (gainLabel) gainLabel.textContent = s.gainBoost.toFixed(1);

  updateSliderLabel(body, '#setting-capture-ramp', s.captureRampMs, 'ms');
  updateSliderLabel(body, '#setting-playback-ramp', s.playbackRampMs, 'ms');
  updateSliderLabel(body, '#setting-fade-in', s.fadeInMs, 'ms');
}

function setValue(body: HTMLElement, selector: string, value: string): void {
  const el = body.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (el) el.value = value;
}

function updateSliderLabel(body: HTMLElement, sliderSelector: string, value: number, unit: string): void {
  const label = body.querySelector(`${sliderSelector}-value`);
  if (label) label.textContent = `${value}${unit}`;
}

function showReconnectHint(body: HTMLElement, show: boolean): void {
  const hint = body.parentElement?.querySelector('.settings-reconnect-hint');
  if (hint) {
    (hint as HTMLElement).style.display = show ? 'inline' : 'none';
  }
}

// --------------------------------------------------------------------------
// Toggle
// --------------------------------------------------------------------------

function toggleBody(container: HTMLElement): void {
  const body = container.querySelector<HTMLElement>('.settings-body');
  const icon = container.querySelector<HTMLElement>('.settings-toggle-icon');
  if (!body) return;

  const isVisible = body.style.display !== 'none';
  body.style.display = isVisible ? 'none' : 'block';
  if (icon) {
    icon.classList.toggle('expanded', !isVisible);
  }
}
