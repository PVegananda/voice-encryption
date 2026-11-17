#!/usr/bin/env python3
"""
Memutar data biner file .vnc terenkripsi langsung sebagai gelombang suara (White Noise/Static)
di macOS menggunakan perintah bawaan 'afplay' atau menyimpannya jadi .wav.
"""
import sys
import wave
import subprocess
from pathlib import Path

def play_encrypted(vnc_path):
    path = Path(vnc_path)
    if not path.exists():
        print(f"Error: File '{vnc_path}' tidak ditemukan.", file=sys.stderr)
        sys.exit(1)

    raw_bytes = path.read_bytes()
    out_wav = path.with_name(f"{path.stem}_suara_terenkripsi.wav")

    # Bungkus byte terenkripsi menjadi format WAV (16-bit PCM Mono, 24kHz)
    with wave.open(str(out_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(raw_bytes)

    print(f"✓ Berhasil membuat file audio mentah: {out_wav.name}")
    print("🔊 Memutar suara data terenkripsi (bunyi derau/white noise)...")
    print("   (Tekan Ctrl+C untuk berhenti)")

    # Putar menggunakan command bawaan macOS 'afplay' dengan volume aman (0.5)
    try:
        subprocess.run(["afplay", "-v", "0.5", str(out_wav)])
    except KeyboardInterrupt:
        print("\n⏹ Dihentikan.")
    except Exception as e:
        print(f"Bisa diputar manual di QuickTime: {out_wav}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Penggunaan: python3 tools/play_raw_encrypted.py <file.vnc>")
        sys.exit(1)
    play_encrypted(sys.argv[1])
