"use client";

// Tap to start, tap to stop: records one sentence, sends it with the item names and the bill's people, and hands
// back what was heard. Recording stops by itself after 30 s.
import { useEffect, useRef, useState } from "react";
import { postVoice, type VoiceResult } from "@/lib/api";

type VoiceState =
  | { k: "idle" }
  | { k: "listening" }
  | { k: "working" }
  | { k: "done"; result: VoiceResult };

const MAX_MS = 30_000;
const SILENCE = 0.02; // peak amplitude (of 1.0) below which a recording held no speech

export function useVoice(items: () => string[], people: () => number[], onHeard: (r: VoiceResult) => void) {
  const [state, setState] = useState<VoiceState>({ k: "idle" });
  const rec = useRef<MediaRecorder | null>(null);
  const starting = useRef(false); // true while the permission prompt is up: a second tap waits
  const gone = useRef(false);
  const released = useRef<(() => void) | null>(null);
  // The item list, the people and the handler are read when recording STOPS, from the latest render:
  // rows edited while recording must be the ones the spoken numbers refer to.
  const latest = useRef({ items, people, onHeard });
  useEffect(() => {
    latest.current = { items, people, onHeard };
  });

  // Leaving the screen mid-recording (or mid-permission-prompt) releases the microphone and
  // sends nothing.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const r = rec.current;
      if (!r) return;
      r.onstop = () => released.current?.(); // the microphone, the meter and its audio context
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
      return finish({ ok: false, error: "no_mic", message: "The microphone is blocked. Allow it for this site, or use the buttons.", retryable: false });
    }
    starting.current = false;
    // A level meter: a clip that never rose above near-silence is not sent - the model would make up
    // a sentence for it - and reads as nothing heard. It counts only while its audio context runs (a
    // suspended one reads zeros, e.g. iOS after the permission prompt); never running, or no Web
    // Audio at all, and the clip is sent as before. The buffer (~0.7 s) spans the 100 ms between reads.
    // The meter is trusted only when it ran from the start (a late start hears just the tail) and
    // heard something at all (a live microphone never reads exactly 0 - zeros mean it is not wired).
    let loudest = 0;
    let metered = false;
    const opened = Date.now();
    let firstRead = 0;
    let read = () => {};
    let meter: ReturnType<typeof setInterval> | undefined;
    let audio: AudioContext | undefined;
    try {
      const ctx = new AudioContext();
      audio = ctx;
      void ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32768;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const wave = new Float32Array(analyser.fftSize);
      read = () => {
        if (ctx.state !== "running") return;
        analyser.getFloatTimeDomainData(wave);
        if (!metered) firstRead = Date.now();
        metered = true;
        for (const v of wave) loudest = Math.max(loudest, Math.abs(v));
      };
      meter = setInterval(read, 100);
    } catch {}
    const release = () => {
      clearInterval(meter);
      void audio?.close().catch(() => {});
      stream.getTracks().forEach((t) => t.stop());
    };
    released.current = release;
    if (gone.current) return release();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        read(); // the last moment before stop counts too
        release();
        rec.current = null;
        const trusted = metered && firstRead - opened < 500 && loudest > 0;
        if (trusted && loudest < SILENCE) return finish({ ok: true, transcript: "", changes: [], dropped: [] });
        setState({ k: "working" });
        finish(await postVoice(new Blob(chunks, { type: r.mimeType }), latest.current.items(), latest.current.people()));
      };
      r.start();
    } catch {
      release();
      return finish({ ok: false, error: "no_recorder", message: "This browser can't record here. Use the buttons.", retryable: false });
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
