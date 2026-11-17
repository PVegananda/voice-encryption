/**
 * VoiceVault Audio Scrambler & Descrambler (Hybrid Security Layer 1)
 *
 * Mengacak gelombang audio (sample & block permutation) di domain sinyal suara.
 * Sifat:
 * 1. Durasi audio scrambled SAMA PERSIS dengan audio asli sampai level milidetik.
 * 2. Mengubah suara manusia menjadi derau/robot tak terdengar polanya.
 * 3. 100% lossless & reversible: saat di-descramble dengan kunci yang sama,
 *    audio kembali jernih tanpa cacat.
 */

// PRNG Xorshift dengan seed string
function createPrng(seedStr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let s = h >>> 0;
  return function nextFloat() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

// Permutasi Fisher-Yates
function getPermutation(length, prng) {
  const perm = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

/**
 * Mengacak data PCM Float32Array.
 * Panjang array (durasi) dijamin 100% sama persis.
 */
export function scramblePcm(pcmData, key, blockSize = 960) {
  const prng = createPrng(key);
  const numBlocks = Math.floor(pcmData.length / blockSize);
  const perm = getPermutation(numBlocks, prng);
  const out = new Float32Array(pcmData.length);

  for (let b = 0; b < numBlocks; b++) {
    const srcIdx = perm[b] * blockSize;
    const destIdx = b * blockSize;
    for (let i = 0; i < blockSize; i++) {
      const invert = prng() > 0.5 ? -1 : 1;
      out[destIdx + i] = pcmData[srcIdx + i] * invert;
    }
  }
  for (let i = numBlocks * blockSize; i < pcmData.length; i++) {
    out[i] = pcmData[i];
  }
  return out;
}

/**
 * Membalikkan pengacakan (descramble) ke bentuk aslinya.
 */
export function descramblePcm(scrambledData, key, blockSize = 960) {
  const prng = createPrng(key);
  const numBlocks = Math.floor(scrambledData.length / blockSize);
  const perm = getPermutation(numBlocks, prng);
  const out = new Float32Array(scrambledData.length);

  const inversions = new Float32Array(numBlocks * blockSize);
  let k = 0;
  for (let b = 0; b < numBlocks; b++) {
    for (let i = 0; i < blockSize; i++) {
      inversions[k++] = prng() > 0.5 ? -1 : 1;
    }
  }

  k = 0;
  for (let b = 0; b < numBlocks; b++) {
    const origBlock = perm[b];
    const srcIdx = b * blockSize;
    const destIdx = origBlock * blockSize;
    for (let i = 0; i < blockSize; i++) {
      out[destIdx + i] = scrambledData[srcIdx + i] * inversions[k++];
    }
  }
  for (let i = numBlocks * blockSize; i < scrambledData.length; i++) {
    out[i] = scrambledData[i];
  }
  return out;
}

/**
 * Decode audio Blob/ArrayBuffer apa saja (.mp3, .wav, .m4a, .webm) menjadi PCM Float32Array
 */
export async function decodeAudioToPcm(blobOrBuffer) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = blobOrBuffer instanceof ArrayBuffer
    ? blobOrBuffer.slice(0)
    : await blobOrBuffer.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(new Float32Array(audioBuffer.getChannelData(c)));
  }
  await audioCtx.close();
  return { channels, sampleRate, duration: audioBuffer.duration };
}

/**
 * Encode PCM Float32Array channel data menjadi standard WAV Blob (16-bit PCM)
 */
export function encodePcmToWav(channels, sampleRate) {
  const numChannels = channels.length;
  const numSamples = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataByteLength = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  // Interleave and write samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
