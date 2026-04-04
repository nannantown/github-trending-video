/**
 * Generate a minimal ambient BGM as WAV using raw PCM synthesis.
 * No external dependencies - pure Node.js.
 * Output: public/audio/bgm.wav
 *
 * Produces a soft, looping lo-fi pad with gentle chord progression.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const audioDir = join(__dirname, "..", "public", "audio");

const SAMPLE_RATE = 44100;
const DURATION = 120; // 2 minutes (loops or fades in video)
const NUM_SAMPLES = SAMPLE_RATE * DURATION;

function generateBGM() {
  const buffer = new Float32Array(NUM_SAMPLES);

  // Chord progression: Am - F - C - G (classic lo-fi progression)
  // Each chord lasts 4 seconds
  const chords = [
    [220.0, 261.63, 329.63],    // Am: A3, C4, E4
    [174.61, 220.0, 261.63],    // F:  F3, A3, C4
    [130.81, 164.81, 196.0],    // C:  C3, E3, G3
    [146.83, 196.0, 246.94],    // G:  G3, B3, D4 (actually D4=293.66, using lower)
  ];

  const chordDuration = 4.0; // seconds per chord
  const totalChordCycle = chords.length * chordDuration;

  for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;

    // Which chord are we in?
    const cyclePos = t % totalChordCycle;
    const chordIdx = Math.floor(cyclePos / chordDuration) % chords.length;
    const chord = chords[chordIdx];

    // Smooth crossfade between chords
    const posInChord = (cyclePos % chordDuration) / chordDuration;
    const envelope =
      posInChord < 0.05
        ? posInChord / 0.05 // fade in
        : posInChord > 0.95
          ? (1 - posInChord) / 0.05 // fade out
          : 1.0;

    let sample = 0;

    // Soft pad: sine waves with slight detuning for warmth
    for (const freq of chord) {
      // Main tone (sine)
      sample += Math.sin(2 * Math.PI * freq * t) * 0.12;
      // Slightly detuned for chorus effect
      sample += Math.sin(2 * Math.PI * (freq * 1.003) * t) * 0.08;
      // Sub octave (very quiet)
      sample += Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.04;
    }

    // Slow LFO for movement
    const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.1 * t);
    sample *= lfo;

    // Apply chord envelope
    sample *= envelope;

    // Gentle overall volume (this will be further reduced in the video)
    sample *= 0.35;

    // Global fade in/out
    if (t < 2.0) sample *= t / 2.0;
    if (t > DURATION - 3.0) sample *= (DURATION - t) / 3.0;

    // Soft clamp
    buffer[i] = Math.max(-1, Math.min(1, sample));
  }

  return buffer;
}

function floatToWav(floatData, sampleRate) {
  const numSamples = floatData.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(headerSize + dataSize - 8, 4);
  buf.write("WAVE", 8);

  // fmt chunk
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buf.writeUInt16LE(bytesPerSample, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  // Convert float to 16-bit PCM
  for (let i = 0; i < numSamples; i++) {
    const val = Math.max(-1, Math.min(1, floatData[i]));
    const intVal = val < 0 ? val * 32768 : val * 32767;
    buf.writeInt16LE(Math.round(intVal), headerSize + i * bytesPerSample);
  }

  return buf;
}

function main() {
  mkdirSync(audioDir, { recursive: true });

  console.log("Generating ambient BGM...");
  const samples = generateBGM();
  const wav = floatToWav(samples, SAMPLE_RATE);

  const outputPath = join(audioDir, "bgm.wav");
  writeFileSync(outputPath, wav);
  console.log(`BGM → ${outputPath} (${(wav.length / 1024 / 1024).toFixed(1)} MB, ${DURATION}s)`);
}

main();
