// The ONLY way uploaded bytes become an image Halves stores or sends to Gemini:
// sniff the real format, allowlist it, cap pixels before decoding, then re-encode to a fresh
// JPEG with no EXIF / location / ICC. The original bytes are never passed on.
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel's request limit is 4.5 MB, multipart included
export const MAX_PIXELS = 30_000_000;
export const MAX_SIDE = 2048; // receipt print is small; tune against real phone photos

export type ImageFormat = "jpeg" | "png" | "webp" | "heif";

export class ImageError extends Error {
  constructor(
    readonly code: "unsupported_image" | "image_too_large" | "unreadable_image",
    message: string,
  ) {
    super(message);
  }
}

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

export function sniffImage(b: Uint8Array): ImageFormat | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12))) return "heif";
  return null;
}

const ACCEPTED: ImageFormat[] = ["jpeg", "png", "webp"];

export async function normaliseImage(input: Buffer, maxPixels = MAX_PIXELS): Promise<Buffer> {
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("image_too_large", "That photo is too big. Crop it or use a smaller one.");
  const fmt = sniffImage(input);
  if (!fmt || !ACCEPTED.includes(fmt)) {
    // HEIC lands here too: the phone's browser converts it to JPEG before upload (see the crop step).
    throw new ImageError("unsupported_image", "This photo format can't be read - take a screenshot of it or use a JPEG.");
  }
  try {
    const img = sharp(input, { limitInputPixels: maxPixels, failOn: "error" });
    const meta = await img.metadata(); // header only
    if (meta.format !== fmt) throw new Error("container does not match its signature");
    return await img
      .rotate() // apply EXIF orientation before the EXIF is dropped
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }) // sharp writes no metadata unless asked to
      .toBuffer();
  } catch (e) {
    if (e instanceof Error && /pixel limit/i.test(e.message)) {
      throw new ImageError("image_too_large", "That photo is too big. Crop it or use a smaller one.");
    }
    throw new ImageError("unreadable_image", "That photo couldn't be read. Try another one.");
  }
}
