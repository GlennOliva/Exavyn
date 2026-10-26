export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
export const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
export const MAX_FILES = 3;
export const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function validateFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (ALLOWED_EXT.some((ext) => lower.endsWith(ext))) return true;
  return false;
}

export async function readFileSignature(file: File): Promise<boolean> {
  const buffer = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // WebP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
  return false;
}

export function isAllowedMime(mime: string): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  if (m === 'image/svg+xml') return false;
  return ALLOWED_MIME.includes(m);
}
