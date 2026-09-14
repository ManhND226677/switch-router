#!/usr/bin/env node
/**
 * Generates the Switch-Router Windows brand icon (`public/icons/switch-router.ico`)
 * plus a PNG preview. Pure Node — no native image dependency, no network.
 *
 * The artwork is drawn from scratch (rounded gradient tile + bidirectional
 * routing arrows) so it shares nothing with the legacy 9router mark.
 *
 * Usage: node scripts/windows/generate-icon.mjs [--out <dir>]
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PREVIEW_SIZE = 256;
const SUPERSAMPLE = 3;

// Brand ramp: indigo -> cyan, drawn diagonally.
const GRADIENT_FROM = [79, 70, 229];
const GRADIENT_TO = [6, 182, 212];
const GLYPH = [255, 255, 255];

const CORNER_RADIUS = 0.22;

const TOP_ARROW = {
  shaft: { ax: 0.24, ay: 0.38, bx: 0.62, by: 0.38, half: 0.058 },
  head: [
    [0.585, 0.235],
    [0.585, 0.525],
    [0.8, 0.38],
  ],
};

const BOTTOM_ARROW = {
  shaft: { ax: 0.38, ay: 0.62, bx: 0.76, by: 0.62, half: 0.058 },
  head: [
    [0.415, 0.475],
    [0.415, 0.765],
    [0.2, 0.62],
  ],
};

function insideRoundedRect(x, y, radius) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  const dx = x - cx;
  const dy = y - cy;
  if (dx === 0 || dy === 0) return true;
  return dx * dx + dy * dy <= radius * radius;
}

function insideSegment(x, y, segment) {
  const { ax, ay, bx, by, half } = segment;
  const vx = bx - ax;
  const vy = by - ay;
  const wx = x - ax;
  const wy = y - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.min(Math.max((wx * vx + wy * vy) / lengthSquared, 0), 1);
  const dx = x - (ax + t * vx);
  const dy = y - (ay + t * vy);
  return dx * dx + dy * dy <= half * half;
}

function insideTriangle(x, y, [p1, p2, p3]) {
  const sign = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  const d1 = sign(p1, p2, [x, y]);
  const d2 = sign(p2, p3, [x, y]);
  const d3 = sign(p3, p1, [x, y]);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function insideGlyph(x, y) {
  return (
    insideSegment(x, y, TOP_ARROW.shaft) ||
    insideTriangle(x, y, TOP_ARROW.head) ||
    insideSegment(x, y, BOTTOM_ARROW.shaft) ||
    insideTriangle(x, y, BOTTOM_ARROW.head)
  );
}

function mixChannel(from, to, t) {
  return Math.round(from + (to - from) * t);
}

/** Renders one square RGBA bitmap (top-down rows) with 3x3 supersampled edges. */
function renderRgba(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);
  const halfStep = step / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let tileHits = 0;
      let glyphHits = 0;
      let gradientSum = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px * SUPERSAMPLE + sx) * step + halfStep;
          const y = (py * SUPERSAMPLE + sy) * step + halfStep;
          if (!insideRoundedRect(x, y, CORNER_RADIUS)) continue;
          tileHits += 1;
          gradientSum += Math.min(Math.max((x + y) / 2, 0), 1);
          if (insideGlyph(x, y)) glyphHits += 1;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (py * size + px) * 4;
      if (tileHits === 0) continue;

      const tileAlpha = tileHits / samples;
      const glyphRatio = glyphHits / tileHits;
      const gradientT = gradientSum / tileHits;
      const base = [
        mixChannel(GRADIENT_FROM[0], GRADIENT_TO[0], gradientT),
        mixChannel(GRADIENT_FROM[1], GRADIENT_TO[1], gradientT),
        mixChannel(GRADIENT_FROM[2], GRADIENT_TO[2], gradientT),
      ];

      rgba[offset] = mixChannel(base[0], GLYPH[0], glyphRatio);
      rgba[offset + 1] = mixChannel(base[1], GLYPH[1], glyphRatio);
      rgba[offset + 2] = mixChannel(base[2], GLYPH[2], glyphRatio);
      rgba[offset + 3] = Math.round(tileAlpha * 255);
    }
  }

  return rgba;
}

/** 32bpp BMP (BITMAPINFOHEADER + bottom-up BGRA + AND mask) — the widest-compatible ICO payload. */
function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR bitmap + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sourceRow = (size - 1 - y) * size * 4;
    const targetRow = y * size * 4;
    for (let x = 0; x < size; x += 1) {
      const s = sourceRow + x * 4;
      const t = targetRow + x * 4;
      pixels[t] = rgba[s + 2];
      pixels[t + 1] = rgba[s + 1];
      pixels[t + 2] = rgba[s];
      pixels[t + 3] = rgba[s + 3];
    }
  }

  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size); // zeroed: alpha channel carries transparency
  header.writeUInt32LE(pixels.length + mask.length, 20);

  return Buffer.concat([header, pixels, mask]);
}

function encodeIco(entries) {
  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);

  let offset = directory.length;
  const payloads = [];

  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
    payloads.push(entry.data);
  });

  return Buffer.concat([directory, ...payloads]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseOutDir(argv) {
  const index = argv.indexOf("--out");
  if (index !== -1 && argv[index + 1]) return path.resolve(REPO_ROOT, argv[index + 1]);
  return path.join(REPO_ROOT, "public", "icons");
}

function main() {
  const outDir = parseOutDir(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  const entries = ICO_SIZES.map((size) => ({ size, data: encodeDib(size, renderRgba(size)) }));
  const icoPath = path.join(outDir, "switch-router.ico");
  writeFileSync(icoPath, encodeIco(entries));

  const pngPath = path.join(outDir, "switch-router-256.png");
  writeFileSync(pngPath, encodePng(PREVIEW_SIZE, renderRgba(PREVIEW_SIZE)));

  process.stdout.write(`${icoPath} (${ICO_SIZES.join(", ")} px)\n${pngPath}\n`);
}

main();
