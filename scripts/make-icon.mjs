// Generates build/icon.png (256x256 RGBA) with no dependencies: a page, text lines and a highlight.
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const pixels = new Uint8Array(SIZE * SIZE * 4)

function blend(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  const alpha = a / 255
  const baseAlpha = pixels[i + 3] / 255
  const outAlpha = alpha + baseAlpha * (1 - alpha)
  if (outAlpha === 0) return
  for (const [channel, value] of [
    [0, r],
    [1, g],
    [2, b]
  ]) {
    pixels[i + channel] = Math.round((value * alpha + pixels[i + channel] * baseAlpha * (1 - alpha)) / outAlpha)
  }
  pixels[i + 3] = Math.round(outAlpha * 255)
}

function roundedRect(x0, y0, x1, y1, radius, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cx = Math.max(x0 + radius, Math.min(x, x1 - 1 - radius))
      const cy = Math.max(y0 + radius, Math.min(y, y1 - 1 - radius))
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) blend(x, y, color)
    }
  }
}

roundedRect(50, 26, 214, 240, 18, [0, 0, 0, 45]) // shadow
roundedRect(42, 18, 206, 232, 18, [47, 98, 200, 255]) // border
roundedRect(48, 24, 200, 226, 14, [255, 255, 255, 255]) // page
for (const [y, right] of [
  [62, 176],
  [92, 168],
  [122, 180],
  [152, 160],
  [182, 172]
]) {
  roundedRect(72, y, right, y + 10, 5, [176, 184, 198, 255]) // text lines
}
roundedRect(64, 114, 188, 140, 6, [255, 214, 0, 150]) // highlight over the third line

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  Buffer.from(pixels.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`wrote build/icon.png (${png.length} bytes)`)
