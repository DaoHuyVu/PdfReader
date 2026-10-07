import { createHash } from 'crypto'
import { open } from 'fs/promises'

export const FINGERPRINT_HEAD_BYTES = 4 * 1024 * 1024

export function fingerprintFromHead(head: Uint8Array, fileSize: number): string {
  return createHash('sha256').update(`pdfreader-v1:${fileSize}:`).update(head).digest('hex')
}

/** Document Fingerprint: hash of the file size and its first 4 MiB. See docs/adr/0001. */
export async function computeFingerprint(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, FINGERPRINT_HEAD_BYTES)
    const head = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const { bytesRead } = await handle.read(head, offset, length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return fingerprintFromHead(head.subarray(0, offset), size)
  } finally {
    await handle.close()
  }
}
