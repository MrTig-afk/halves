"use client";

// Tap to start, tap to stop: records one sentence, sends it with the item names, and hands
// back what was heard. Recording stops by itself after 30 s.
import { useEffect, useRef, useState } from "react";
import { postVoice, type VoiceResult } from "@/lib/api";

type VoiceState =
  | { k: "idle" }
  | { k: "listening" }
  | { k: "working" }
  | { k: "done"; result: VoiceResult };

const MAX_MS = 30_000;

export function useVoice(items: () => string[], onHeard: (r: VoiceResult) => void) {
  const [state, setState] = useState<VoiceState>({ k: "idle" });
  const rec = useRef<MediaRecorder | null>(null);
  const starting = useRef(false); // true while the permission prompt is up: a second tap waits
  const gone = useRef(false);
  // The item list and the handler are read when recording STOPS, from the latest render: rows
  // edited while recording must be the ones the spoken numbers refer to.
  const latest = useRef({ items, onHeard });
  useEffect(() => {
    latest.current = { items, onHeard };
  });

  // Leaving the screen mid-recording (or mid-permission-prompt) releases the microphone and
  // sends nothing.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const r = rec.current;
      if (!r) return;
      r.onstop = () => r.stream.getTracks().forEach((t) => t.stop());
      r.stop();
    };
  }, []);

  const finish = (r: VoiceResult) => {
    setState({ k: "done", result: r });
    latest.current.onHeard(r);
  };

  const start = async () => {
    starting.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      starting.current = false;
      return finish({ ok: false, error: "no_mic", message: "The microphone is blocked. Allow it for this site, or use the sliders.", retryable: false });
    }
    starting.current = false;
    const release = () => stream.getTracks().forEach((t) => t.stop());
    if (gone.current) return release();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        release();
        rec.current = null;
        setState({ k: "working" });
        finish(await postVoice(new Blob(chunks, { type: r.mimeType }), latest.current.items()));
      };
      r.start();
    } catch {
      release();
      return finish({ ok: false, error: "no_recorder", message: "This browser can't record here. Use the sliders.", retryable: false });
    }
    rec.current = r;
    setState({ k: "listening" });
    setTimeout(() => r.state === "recording" && r.stop(), MAX_MS);
  };

  const toggle = () => {
    if (state.k === "listening") rec.current?.stop();
    else if (state.k !== "working" && !starting.current) void start();
  };

  return { state, toggle, reset: () => setState({ k: "idle" }) };
}
