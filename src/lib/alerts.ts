"use client";

/**
 * Âm thanh + rung báo tour mới / cảnh báo admin. Âm thanh tạo bằng Web Audio
 * (không cần file mp3). iOS chỉ cho phát âm thanh sau khi người dùng chạm vào
 * màn hình ít nhất 1 lần → gọi unlockAudio() ở lần chạm đầu tiên.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

export function unlockAudio() {
  const a = audio();
  if (a && a.state === "suspended") void a.resume();
}

function tone(a: AudioContext, freq: number, start: number, duration: number, gain = 0.25) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(a.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Chuông 3 nốt nhẹ nhàng (kiểu chuông spa) */
export function playChime(times = 1) {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume();
  for (let i = 0; i < times; i++) {
    const t = a.currentTime + i * 1.4;
    tone(a, 880, t, 0.9);
    tone(a, 1318.5, t + 0.18, 0.9, 0.2);
    tone(a, 1760, t + 0.36, 1.1, 0.15);
  }
}

/** Âm báo ngắn cho admin (KTV từ chối / hết giờ) */
export function playAlert() {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume();
  tone(a, 660, a.currentTime, 0.35, 0.3);
  tone(a, 520, a.currentTime + 0.3, 0.5, 0.3);
}

export function vibrate(pattern: number | number[] = [400, 150, 400, 150, 400]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* iOS không hỗ trợ */
    }
  }
}
