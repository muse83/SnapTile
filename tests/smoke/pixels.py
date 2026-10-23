#!/usr/bin/env python3
"""Print the RGBA value of pixels in a PNG file: pixels.py FILE X Y [X Y ...]

Standard library only: the dev images have no PNG decoder for gdk-pixbuf on every
GNOME version. Reads the 8-bit RGBA/RGB, non-interlaced PNGs the shell writes.
"""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG file'
    pos, idat = 8, b''
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            idat += body
        pos += 12 + length
    assert depth == 8 and color in (2, 6) and interlace == 0, 'unsupported PNG layout'
    bpp = 4 if color == 6 else 3
    raw = zlib.decompress(idat)
    stride = width * bpp
    rows, prev = [], bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        filt, line = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if filt == 1:
                line[i] = (line[i] + a) & 255
            elif filt == 2:
                line[i] = (line[i] + b) & 255
            elif filt == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 255
        rows.append(line)
        prev = line
    return width, height, bpp, rows


if __name__ == '__main__':
    width, height, bpp, rows = read_png(sys.argv[1])
    coords = list(map(int, sys.argv[2:]))
    for x, y in zip(coords[::2], coords[1::2]):
        px = rows[y][x * bpp:(x + 1) * bpp]
        print(*px, 255 if bpp == 3 else '')
