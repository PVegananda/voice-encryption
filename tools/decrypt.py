#!/usr/bin/env python3
"""
VoiceVault — dekripsi file .vnc secara offline.

Format (big-endian), identik dengan public/js/crypto.js:
  [ "VNC1" 4B ][ iterasi u32 ][ salt 16B ][ iv 12B ][ len mime u8 ][ mime ][ ciphertext + tag 16B ]
Kunci: PBKDF2-HMAC-SHA256(password, salt, iterasi) -> 32 byte, AES-256-GCM, header = AAD.

Contoh:
  python decrypt.py note.vnc
  python decrypt.py vault/*.vnc -o hasil/
  VNC_PASSWORD=rahasia python decrypt.py note.vnc   # non-interaktif
"""
from __future__ import annotations

import argparse
import getpass
import os
import struct
import sys
import unicodedata
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAGIC = b"VNC1"
SALT_LEN = 16
IV_LEN = 12
TAG_LEN = 16
MAX_ITERATIONS = 10_000_000
EXTENSIONS = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "text/plain": ".txt",
}


class VncError(Exception):
    pass


def parse_header(data: bytes) -> tuple[int, bytes, bytes, str, int]:
    fixed = len(MAGIC) + 4 + SALT_LEN + IV_LEN + 1
    if len(data) < fixed + TAG_LEN or data[:4] != MAGIC:
        raise VncError("bukan file VoiceVault (.vnc)")
    o = len(MAGIC)
    (iterations,) = struct.unpack(">I", data[o : o + 4]); o += 4
    if not 1 <= iterations <= MAX_ITERATIONS:
        raise VncError("parameter iterasi tidak valid")
    salt = data[o : o + SALT_LEN]; o += SALT_LEN
    iv = data[o : o + IV_LEN]; o += IV_LEN
    mime_len = data[o]; o += 1
    if o + mime_len + TAG_LEN > len(data):
        raise VncError("header rusak")
    mime = data[o : o + mime_len].decode("utf-8", "replace"); o += mime_len
    return iterations, salt, iv, mime, o


def decrypt(data: bytes, password: str) -> tuple[bytes, str]:
    iterations, salt, iv, mime, header_len = parse_header(data)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    key = kdf.derive(unicodedata.normalize("NFC", password).encode("utf-8"))
    try:
        plain = AESGCM(key).decrypt(iv, data[header_len:], data[:header_len])
    except InvalidTag:
        raise VncError("password salah atau file rusak") from None
    return plain, mime


def main() -> int:
    ap = argparse.ArgumentParser(description="Dekripsi voice note .vnc dari VoiceVault")
    ap.add_argument("files", nargs="+", type=Path, help="file .vnc")
    ap.add_argument("-o", "--out", type=Path, help="folder output (default: sama dengan file asal)")
    ap.add_argument("-f", "--force", action="store_true", help="timpa file output jika sudah ada")
    args = ap.parse_args()

    password = os.environ.get("VNC_PASSWORD") or getpass.getpass("Password: ")
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)

    failed = 0
    for path in args.files:
        try:
            plain, mime = decrypt(path.read_bytes(), password)
        except (OSError, VncError) as e:
            print(f"✗ {path.name}: {e}", file=sys.stderr)
            failed += 1
            continue
        ext = EXTENSIONS.get(mime.split(";")[0], ".bin")
        target = (args.out or path.parent) / (path.stem + ext)
        if target.exists() and not args.force:
            print(f"✗ {path.name}: {target} sudah ada (pakai --force)", file=sys.stderr)
            failed += 1
            continue
        target.write_bytes(plain)
        print(f"✓ {path.name} → {target} ({mime}, {len(plain):,} byte)")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
