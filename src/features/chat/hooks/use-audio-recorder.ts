"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "recorded";

type UseAudioRecorderReturn = {
  state: RecorderState;
  seconds: number;
  audioUrl: string | null;
  audioBlob: Blob | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
};

/**
 * Wraps the MediaRecorder API for push-to-talk voice notes.
 * Produces an audio/webm (opus) blob — converted server-side per provider.
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setState("idle");
    setSeconds(0);
    setAudioBlob(null);
    setError(null);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [clearTimer]);

  const start = useCallback(async () => {
    setError(null);
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        releaseStream();
        clearTimer();
        if (cancelledRef.current) return;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setState("recorded");
      };

      recorder.start();
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      releaseStream();
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        setError("Permissão de microfone negada.");
      } else if (name === "NotFoundError") {
        setError("Nenhum microfone encontrado.");
      } else {
        setError("Não foi possível acessar o microfone.");
      }
      setState("idle");
    }
  }, [clearTimer, releaseStream]);

  const stop = useCallback(() => {
    if (recorderRef.current && state === "recording") {
      cancelledRef.current = false;
      recorderRef.current.stop();
    }
  }, [state]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current && state === "recording") {
      recorderRef.current.stop();
    }
    reset();
  }, [state, reset]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      releaseStream();
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [clearTimer, releaseStream]);

  return { state, seconds, audioUrl, audioBlob, error, start, stop, cancel, reset };
}
