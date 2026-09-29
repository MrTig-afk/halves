import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, normaliseImage, sniffImage } from "./image";

// Synthetic receipt carrying EXIF (Make: ProbeCam) - see fixtures/public/coles.html.
const receipt = readFileSync("fixtures/public/coles.jpg");
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const code = async (b: Buffer, maxPixels?: number) => {
  try {
    await normaliseImage(b, maxPixels);
    return "accepted";
  } catch (e) {
    return (e as ImageError).code;
  }
};

describe("sniffImage", () => {
  it.each([
    ["jpeg", receipt],
    ["png", bytes("\x89PNG\r\n\x1a\n....")],
    ["webp", bytes("RIFF\0\0\0\0WEBPVP8 ")],
    ["heif", bytes("\0\0\0\x18ftypheic\0\0\0\0")],
    [null, bytes("<html>not an image</html>")],
  ])("reads %s from the bytes", (want, b) => {
    expect(sniffImage(b)).toBe(want);
  });
});

describe("normaliseImage", () => {
  it("re-encodes to a JPEG with the EXIF removed", async () => {
    expect((await sharp(receipt).metadata()).exif).toBeDefined(); // positive control: the input has EXIF
    const out = await normaliseImage(receipt);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("shrinks anything bigger than 2048 px on its longest side", async () => {
    const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#fff" } }).png().toBuffer();
    const meta = await sharp(await normaliseImage(big)).metadata();
    expect([meta.width, meta.height]).toEqual([2048, 683]);
  });

  it("refuses a non-image and a HEIC with the screenshot message", async () => {
    expect(await code(Buffer.from("<html>not an image</html>"))).toBe("unsupported_image");
    expect(await code(Buffer.from(bytes("\0\0\0\x18ftypheic\0\0\0\0")))).toBe("unsupported_image");
  });

  it("refuses an image over the pixel cap before decoding it", async () => {
    expect(await code(receipt, 1000)).toBe("image_too_large");
    expect(await code(receipt)).toBe("accepted"); // same image passes under the real cap
  });

  it("refuses a file whose contents do not match its signature", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("garbage after a JPEG header")]);
    expect(await code(fake)).toBe("unreadable_image");
  });
});
