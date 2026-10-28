// Distance measurement maths. Pure functions (no DOM), so they can be tested in Node.

// 35 mm-equivalent focal length from a JPEG's EXIF data, or null if absent
export function readFocal35(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseExif(v, off + 10);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      off += 2 + len;
    }
  } catch (e) { /* no usable EXIF */ }
  return null;
}

function parseExif(v, t) {
  const little = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(o, little), u32 = (o) => v.getUint32(o, little);
  const ifd = (o) => {
    const n = u16(o), out = {};
    for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; out[u16(e)] = e + 8; }
    return out;
  };
  const ifd0 = ifd(t + u32(t + 4));
  if (!ifd0[0x8769]) return null;
  const exif = ifd(t + u32(ifd0[0x8769]));
  if (!exif[0xA405]) return null;                  // FocalLengthIn35mmFilm
  const f = u16(exif[0xA405]);
  return f >= 8 && f <= 600 ? f : null;
}

// Focal length in pixels from a 35 mm-equivalent focal length (defined on the 43.27 mm sensor diagonal)
export function focalPixels(f35, w, h) { return Math.hypot(w, h) * f35 / 43.27; }

// Median depth in a (2r+1)^2 window around (u, v), both in 0..1. Robust to single-pixel noise at edges.
export function sampleDepth(map, w, h, u, v, r) {
  const cx = Math.round(u * (w - 1)), cy = Math.round(v * (h - 1)), vals = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) vals.push(map[y * w + x]);
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

// Pinhole camera: pixel (u, v in 0..1 of the photo) and depth z (metres along the optical axis) -> metres in camera space
export function unproject(u, v, z, photoW, photoH, fpx) {
  return [(u * photoW - photoW / 2) * z / fpx, (v * photoH - photoH / 2) * z / fpx, z];
}

export function measure(map, w, h, a, b, photoW, photoH, f35) {
  const fpx = focalPixels(f35, photoW, photoH);
  const za = sampleDepth(map, w, h, a.u, a.v, 2), zb = sampleDepth(map, w, h, b.u, b.v, 2);
  const pa = unproject(a.u, a.v, za, photoW, photoH, fpx), pb = unproject(b.u, b.v, zb, photoW, photoH, fpx);
  const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  return { distance: Math.hypot(d[0], d[1], d[2]), dx: Math.abs(d[0]), dy: Math.abs(d[1]), dz: Math.abs(d[2]), za, zb };
}

export function formatMeters(m) {
  if (m < 1) return (m * 100).toFixed(0) + ' cm';
  return m.toFixed(m < 10 ? 2 : 1) + ' m';
}
