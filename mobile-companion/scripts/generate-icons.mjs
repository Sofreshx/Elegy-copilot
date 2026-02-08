/**
 * Generate simple PWA icons for Instruction Engine Mobile.
 * Creates minimal PNG files with the "IE" branding using raw PNG encoding.
 * No external dependencies required — uses Node.js built-in APIs only.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'public', 'icons');

// Colors matching the PWA theme
const BG_COLOR = { r: 26, g: 26, b: 46 }; // #1a1a2e
const FG_COLOR = { r: 99, g: 102, b: 241 }; // #6366f1 (indigo/primary)
const TEXT_COLOR = { r: 255, g: 255, b: 255 }; // white

/**
 * Simple 5x7 bitmap font for uppercase letters (used for "IE")
 */
const FONT = {
  I: [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  E: [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
};

/**
 * Create a raw RGBA pixel buffer with the IE logo
 */
function createIconBuffer(size) {
  const pixels = new Uint8Array(size * size * 4);

  // Fill background
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = BG_COLOR.r;
    pixels[i * 4 + 1] = BG_COLOR.g;
    pixels[i * 4 + 2] = BG_COLOR.b;
    pixels[i * 4 + 3] = 255;
  }

  // Draw rounded rectangle (circle-ish for maskable)
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.38; // Circle radius for the logo background

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const idx = (y * size + x) * 4;
        pixels[idx] = FG_COLOR.r;
        pixels[idx + 1] = FG_COLOR.g;
        pixels[idx + 2] = FG_COLOR.b;
        pixels[idx + 3] = 255;
      }
    }
  }

  // Draw "IE" text
  const letterI = FONT.I;
  const letterE = FONT.E;
  const letterHeight = letterI.length;
  const letterIWidth = letterI[0].length;
  const letterEWidth = letterE[0].length;
  const spacing = 1; // pixels between letters in font units
  const totalFontWidth = letterIWidth + spacing + letterEWidth;

  // Scale factor for the text
  const scale = Math.floor(size * 0.08);
  const textWidth = totalFontWidth * scale;
  const textHeight = letterHeight * scale;

  const startX = Math.floor((size - textWidth) / 2);
  const startY = Math.floor((size - textHeight) / 2);

  function drawLetter(letter, offsetX) {
    for (let row = 0; row < letter.length; row++) {
      for (let col = 0; col < letter[row].length; col++) {
        if (letter[row][col]) {
          // Draw scaled pixel
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = startX + (offsetX + col) * scale + sx;
              const py = startY + row * scale + sy;
              if (px >= 0 && px < size && py >= 0 && py < size) {
                const idx = (py * size + px) * 4;
                pixels[idx] = TEXT_COLOR.r;
                pixels[idx + 1] = TEXT_COLOR.g;
                pixels[idx + 2] = TEXT_COLOR.b;
                pixels[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }

  drawLetter(letterI, 0);
  drawLetter(letterE, letterIWidth + spacing);

  return pixels;
}

/**
 * Encode a raw RGBA pixel buffer as a PNG file (minimal encoder)
 */
function encodePNG(pixels, width, height) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
      rawData[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }

  const compressedData = deflateSync(rawData);

  function createChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = crc32(crcData);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc >>> 0, 0);

    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
  }

  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * CRC32 implementation for PNG chunks
 */
function crc32(buf) {
  // Pre-computed CRC table
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate icons
mkdirSync(ICONS_DIR, { recursive: true });

for (const size of [192, 512]) {
  const pixels = createIconBuffer(size);
  const png = encodePNG(pixels, size, size);
  const path = join(ICONS_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Generated ${path} (${png.length} bytes)`);
}

console.log('Done!');
