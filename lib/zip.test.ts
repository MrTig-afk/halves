import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { zip, type ZipEntry } from "./zip";

async function* from(entries: ZipEntry[]) {
  for (const e of entries) yield e;
}
const collect = async (entries: ZipEntry[]) => {
  const parts: Uint8Array[] = [];
  for await (const c of zip(from(entries))) parts.push(c);
  return Buffer.concat(parts);
};

// Reads a zip back through its central directory, the way unzip tools do.
function read(buf: Buffer) {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: { name: string; data: Buffer; crcOk: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const data = buf.subarray(start, start + size);
    out.push({ name, data, crcOk: crc32(data) === crc });
    at += 46 + nameLen;
  }
  return out;
}

describe("zip", () => {
  it("round-trips entries through the central directory with correct CRCs and UTF-8 names", async () => {
    const d = new Date("2026-09-29T17:42:10Z"); // wall-clock time in the UTC fields
    const buf = await collect([
      { name: "2026-09-29_12_Coles.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), date: d },
      { name: "2026-09-30_13_Café.jpg", data: Buffer.from("second"), date: d },
    ]);
    expect(read(buf)).toEqual([
      { name: "2026-09-29_12_Coles.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), crcOk: true },
      { name: "2026-09-30_13_Café.jpg", data: Buffer.from("second"), crcOk: true },
    ]);
  });

  it("writes a valid empty archive", async () => {
    const buf = await collect([]);
    expect(buf.length).toBe(22);
    expect(read(buf)).toEqual([]);
  });
});

describe("zip entry times", () => {
  it("stores the wall-clock time it is given, whatever the server's zone", async () => {
    const buf = await collect([{ name: "a", data: Buffer.from("x"), date: new Date("2026-10-01T08:30:00Z") }]);
    const time = buf.readUInt16LE(10);
    const date = buf.readUInt16LE(12);
    expect([time >> 11, (time >> 5) & 63]).toEqual([8, 30]);
    expect([(date >> 9) + 1980, (date >> 5) & 15, date & 31]).toEqual([2026, 10, 1]);
  });
});
