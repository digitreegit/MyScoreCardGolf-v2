// Voice score entry: OS speech recognizer → on-device rule parser (src/domain/voice).
// On-device recognition is requested when the OS supports it, so audio stays on the phone.

import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';

import { parseScoreUtterance, VOICE_CONTEXT_HINTS, type ParsedScore } from '@/domain/voice/parseScoreUtterance';
import { speechLocale } from '@/i18n';

export type VoiceState = 'idle' | 'listening' | 'denied' | 'unavailable';

export function useVoiceScore(onParsed: (parsed: ParsedScore | null, transcript: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const handled = useRef(false);
  const callback = useRef(onParsed);
  callback.current = onParsed;

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setTranscript(text);
    if (event.isFinal && !handled.current) {
      handled.current = true;
      callback.current(parseScoreUtterance(text), text);
    }
  });
  useSpeechRecognitionEvent('end', () => setState((s) => (s === 'listening' ? 'idle' : s)));
  useSpeechRecognitionEvent('error', () => setState((s) => (s === 'listening' ? 'idle' : s)));

  const start = useCallback(async () => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setState('unavailable');
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setState('denied');
      return;
    }
    handled.current = false;
    setTranscript('');
    setState('listening');
    ExpoSpeechRecognitionModule.start({
      lang: speechLocale(),
      interimResults: true,
      contextualStrings: VOICE_CONTEXT_HINTS,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    });
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { state, transcript, start, stop };
}
