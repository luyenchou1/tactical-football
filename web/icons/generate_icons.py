#!/usr/bin/env python3
"""Generate PWA app icons for Tactical Football.

Pure standard library (zlib + struct) — no third-party deps, so it runs
anywhere Python 3 does and the icons are fully reproducible. Draws a
full-bleed green field tile with a centered American football and laces.
The football sits inside the central 80% "safe zone", so the icons double
as maskable icons.

Run:  python3 generate_icons.py
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))


def _chunk(typ, data):
    return (struct.pack(">I", len(data)) + typ + data +
            struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))


def write_png(path, w, h, rgba):
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += rgba[y * stride:(y + 1) * stride]
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + _chunk(b"IHDR", ihdr) +
                _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))


def lerp(a, b, t):
    return a + (b - a) * t


def render(size, ss=3):
    """Render one icon at `size`x`size`, supersampled by `ss` for smooth edges."""
    S = size * ss
    buf = bytearray(S * S * 3)
    cx = cy = S / 2.0
    ar, br = 0.345 * S, 0.205 * S          # football inner radii
    edge = 0.020 * S                       # white outline ring thickness
    aro, bro = ar + edge, br + edge
    seam_w, seam_h = 0.013 * S, 0.130 * S  # vertical seam
    cross_w, cross_h = 0.052 * S, 0.013 * S  # crossbar half-extents
    cross_ys = [k * 0.060 * S for k in (-2, -1, 0, 1, 2)]

    for y in range(S):
        ty = y / (S - 1)
        bg = (int(lerp(74, 40, ty)), int(lerp(150, 116, ty)), int(lerp(86, 58, ty)))
        dy = y - cy
        row = y * S * 3
        for x in range(S):
            dx = x - cx
            i = row + x * 3
            if (dx * dx) / (ar * ar) + (dy * dy) / (br * br) <= 1.0:
                # inside football: vertical brown gradient
                fy = (dy + br) / (2 * br)
                r = int(lerp(180, 120, fy))
                g = int(lerp(98, 58, fy))
                b = int(lerp(48, 26, fy))
                # laces (white) — seam + crossbars
                white = (abs(dx) <= seam_w and abs(dy) <= seam_h)
                if not white:
                    for cyk in cross_ys:
                        if abs(dy - cyk) <= cross_h and abs(dx) <= cross_w:
                            white = True
                            break
                if white:
                    r, g, b = 245, 245, 240
                buf[i] = r; buf[i + 1] = g; buf[i + 2] = b
            elif (dx * dx) / (aro * aro) + (dy * dy) / (bro * bro) <= 1.0:
                buf[i] = 245; buf[i + 1] = 245; buf[i + 2] = 240  # outline ring
            else:
                buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]

    # box-downsample ss*ss -> 1, add opaque alpha
    out = bytearray(size * size * 4)
    n = ss * ss
    for oy in range(size):
        for ox in range(size):
            R = G = B = 0
            for sy in range(ss):
                base = ((oy * ss + sy) * S + ox * ss) * 3
                for sx in range(ss):
                    p = base + sx * 3
                    R += buf[p]; G += buf[p + 1]; B += buf[p + 2]
            o = (oy * size + ox) * 4
            out[o] = R // n; out[o + 1] = G // n; out[o + 2] = B // n; out[o + 3] = 255
    return out


def main():
    for size, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                        (180, "apple-touch-icon.png")]:
        write_png(os.path.join(HERE, name), size, size, render(size))
        print("wrote", name)


if __name__ == "__main__":
    main()
