import './style.css';
import { WebSocketManager } from './websocket.js';
import { AudioManager } from './audio.js';
import { DebugLogger } from './logger.js';
import {
  setStatus,
  addTranscriptEntry,
  toggleConnectButton,
  setInputsEnabled,
  generateUUID,
  qs,
  setText
} from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  const logger = new DebugLogger('debug-log');

  logger.log('Application initializing...');

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

  // Audio manager
  const audioManager = new AudioManager((msg) => logger.log(msg));

  wsManager.setAudioBinaryHandler((data) => {
    try {
      audioManager.playAudio(data);
    } catch (e) {
      logger.log(`Audio playback error: ${e}`);
    }
  });

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
        connected = true;
        break;
      case 'connecting':
        setStatus('Connecting...', 'yellow');
        toggleConnectButton(true);
        setInputsEnabled(false);
        connected = false;
        break;
      case 'disconnected':
        setStatus('Disconnected', 'red');
        toggleConnectButton(false);
        setInputsEnabled(true);
        if (connected) {
          audioManager.stopCapture();
          connected = false;
        }
        break;
      case 'error':
        setStatus('Error', 'red');
        toggleConnectButton(false);
        setInputsEnabled(true);
        audioManager.stopCapture();
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
  connectBtn.addEventListener('click', () => {
    if (wsManager.getState() === 'connected' || wsManager.getState() === 'connecting') {
      logger.log('User requested disconnect');
      audioManager.stopCapture();
      wsManager.disconnect();
    } else {
      const phone = phoneInput.value.trim();
      if (!phone) {
        setText('#status-text', 'Please enter a phone number');
        setStatus('', 'red');
        return;
      }
      const convId = convIdInput.value.trim() || generateUUID();
      convIdInput.value = convId;
      logger.log(`Starting connection: phone=${phone} conv=${convId}`);
      wsManager.connect(phone, convId);
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

  logger.log('Application ready');
});
