import './style.css';
import { WebSocketManager } from './websocket.js';
import { AudioManager } from './audio.js';
import { DebugLogger } from './logger.js';
import { SettingsManager } from './settings.js';
import { buildSettingsPanel } from './settings-ui.js';
import {
  setStatus,
  addTranscriptEntry,
  toggleConnectButton,
  setInputsEnabled,
  generateUUID,
  qs,
  setText,
} from './ui.js';

// CONNECT_ENDPOINT is now read from SettingsManager

document.addEventListener('DOMContentLoaded', () => {
  const logger = new DebugLogger('debug-log');

  logger.log('Application initializing...');

  // Settings manager
  const settings = new SettingsManager();

  // Wire phone and conversation ID defaults
  const phoneInput = qs<HTMLInputElement>('#phone-input');
  phoneInput.value = '0909835115';

  const convIdInput = qs<HTMLInputElement>('#conversation-id');
  convIdInput.value = generateUUID();

  // Websocket manager
  const wsManager = new WebSocketManager(
    (type, data) => {
      handleMessage(type, data);
    },
    (state) => {
      handleStateChange(state);
    },
    (msg) => logger.log(msg)
  );

  // Audio manager (with settings)
  const audioManager = new AudioManager((msg) => logger.log(msg), settings);

  wsManager.setAudioBinaryHandler((data) => {
    try {
      audioManager.playAudio(data);
    } catch (e) {
      logger.log(`Audio playback error: ${e}`);
    }
  });

  // Settings panel
  const settingsPanel = buildSettingsPanel(settings, (requiresReconnect) => {
    if (requiresReconnect) {
      logger.log(
        'Settings applied. Disconnect and reconnect for audio changes to take effect.'
      );
    } else {
      // Live-update gain if connected
      if (connected && audioManager.isActive()) {
        audioManager.updateGain(settings.getGainBoost());
      }
      logger.log('Settings applied.');
    }
  });

  // Inject settings panel into the right column (after the debug log card)
  const rightColumn = document.querySelector('.main-grid > div:last-child');
  const debugCard = rightColumn?.querySelector('.card');
  if (debugCard && rightColumn) {
    settingsPanel.container.style.marginTop = '20px';
    debugCard.insertAdjacentElement('afterend', settingsPanel.container);
  }

  // Measure settings panel expanded height, match conversation to it
  const settingsBody = settingsPanel.container.querySelector('.settings-body') as HTMLElement;
  const transcriptContainer = document.querySelector('.transcript-container') as HTMLElement;
  if (settingsBody && transcriptContainer) {
    const wasCollapsed = settingsBody.style.display === 'none';
    settingsBody.style.display = 'block';
    const settingsFullHeight = settingsPanel.container.scrollHeight;
    if (wasCollapsed) settingsBody.style.display = 'none';
    // Subtract conversation card chrome (padding + title ≈ 80px)
    transcriptContainer.style.height = Math.max(settingsFullHeight - 80, 200) + 'px';
  }

  let connected = false;

  function handleMessage(type: string, data: unknown): void {
    switch (type) {
      case 'bot-ready':
        logger.log('Bot is ready!');
        addTranscriptEntry('bot', 'Ready to chat.');
        startMicrophone();
        break;
      case 'user-transcription': {
        const text = (data as { text?: string })?.text ?? '';
        logger.log(`User said: "${text}"`);
        addTranscriptEntry('user', text);
        break;
      }
      case 'bot-output': {
        const text = (data as { text?: string })?.text ?? '';
        logger.log(`Bot said: "${text}"`);
        addTranscriptEntry('bot', text);
        break;
      }
      case 'bot-error':
        logger.log(`Bot error: ${JSON.stringify(data)}`);
        break;
      case 'bot-started-speaking':
        logger.log('Bot started speaking');
        break;
      case 'bot-stopped-speaking':
        logger.log('Bot stopped speaking');
        break;
      default:
        logger.log(`Message: type="${type}" data=${JSON.stringify(data)}`);
    }
  }

  function handleStateChange(state: string): void {
    switch (state) {
      case 'connected':
        setStatus('Connected', 'green');
        toggleConnectButton(true);
        setInputsEnabled(false);
        settingsPanel.setEnabled(false);
        connected = true;
        break;
      case 'connecting':
        setStatus('Connecting...', 'yellow');
        toggleConnectButton(true);
        setInputsEnabled(false);
        settingsPanel.setEnabled(false);
        connected = false;
        break;
      case 'disconnected':
        setStatus('Disconnected', 'red');
        toggleConnectButton(false);
        setInputsEnabled(true);
        settingsPanel.setEnabled(true);
        if (connected) {
          audioManager.dispose();
          connected = false;
        }
        break;
      case 'error':
        setStatus('Error', 'red');
        toggleConnectButton(false);
        setInputsEnabled(true);
        settingsPanel.setEnabled(true);
        audioManager.dispose();
        connected = false;
        break;
    }
  }

  async function startMicrophone(): Promise<void> {
    try {
      await audioManager.startCapture((audioData) => {
        wsManager.sendBinary(audioData);
      });
      logger.log('Microphone active, sending audio...');
    } catch (e) {
      logger.log(`Microphone error: ${e}`);
    }
  }

  // Connect / Disconnect button
  const connectBtn = qs<HTMLButtonElement>('#btn-connect');
  connectBtn.addEventListener('click', async () => {
    if (
      wsManager.getState() === 'connected' ||
      wsManager.getState() === 'connecting'
    ) {
      logger.log('User requested disconnect');
      audioManager.dispose();
      wsManager.disconnect();
    } else {
      const phone = phoneInput.value.trim();
      if (!phone) {
        setText('#status-text', 'Please enter a phone number');
        setStatus('', 'red');
        return;
      }
      logger.log(`Starting connection...`);
      try {
        // Warm up AudioContext BEFORE WebSocket connects so Chrome's startup
        // click happens outside the audio flow (no audio yet).
        await audioManager.ensureContext(settings.getSampleRate());
        await wsManager.startBotAndConnect(settings.getServerUrl());
        logger.log('Connection complete');
      } catch (e) {
        logger.log(`Connection failed: ${e}`);
      }
    }
  });

  // Clear log button
  const clearBtn = qs<HTMLButtonElement>('#btn-clear');
  clearBtn.addEventListener('click', () => {
    logger.clear();
  });

  // New conversation button
  const newConvBtn = qs<HTMLButtonElement>('#btn-new-conv');
  newConvBtn.addEventListener('click', () => {
    convIdInput.value = generateUUID();
    const transcript = document.querySelector('#transcript');
    if (transcript) transcript.innerHTML = '';
    logger.log('New conversation ID generated');
  });

  // Clear conversation button
  const clearConvBtn = qs<HTMLButtonElement>('#btn-clear-conversation');
  clearConvBtn.addEventListener('click', () => {
    const transcript = document.querySelector('#transcript');
    if (transcript) transcript.innerHTML = '';
    logger.log('Conversation cleared');
  });

  logger.log('Application ready');
});
