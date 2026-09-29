import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, archiveExport, exportPhotos, listPhotos, stampExport } = vi.hoisted(() => ({
  currentPerson: vi.fn(),
  archiveExport: vi.fn(),
  exportPhotos: vi.fn(),
  listPhotos: vi.fn(),
  stampExport: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/photos", () => ({ archiveExport, exportPhotos, listPhotos, stampExport }));
const { GET: exportZip } = await import("./export/route");
const { POST: archive } = await import("./archive/route");

const admin = { id: 1, name: "Kaushik", role: "admin" };
const member = { id: 4, name: "Soham", role: "member" };
const get = (upto: string, t = "1790000000000") => exportZip(new Request(`http://x/api/photos/export?upto=${upto}&t=${t}`));
const post = (body: unknown) => archive(new Request("http://x/api/photos/archive", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  currentPerson.mockResolvedValue(admin);
});

describe("photo export", () => {
  it("is for the admin only, on both routes", async () => {
    currentPerson.mockResolvedValue(member);
    expect((await get("5")).status).toBe(403);
    expect((await post({ upto: 5 })).status).toBe(403);
    currentPerson.mockResolvedValue(null);
    expect((await get("5")).status).toBe(401);
    expect(listPhotos).not.toHaveBeenCalled();
    expect(archiveExport).not.toHaveBeenCalled();
  });

  it("lists the admin's photos up to the id first, then streams them as a zip under the export's token", async () => {
    listPhotos.mockResolvedValueOnce([{ id: 3 }]);
    exportPhotos.mockImplementation(async function* (_list: unknown, sent: number[]) {
      sent.push(3);
      yield { name: "a.jpg", data: Buffer.from("x"), date: new Date("2026-09-29T00:00:00Z") };
    });
    const res = await get("7", "1790000000123");
    expect(stampExport).not.toHaveBeenCalled();
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="halves-photos-\d{4}-\d{2}\.zip"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(listPhotos).toHaveBeenCalledWith(1, 7);
    expect(exportPhotos).toHaveBeenCalledWith([{ id: 3 }], [3]);
    expect(stampExport).toHaveBeenCalledWith([3], 1790000000123); // only once the directory was read
  });

  it("stamps nothing when the download is cancelled before the end", async () => {
    listPhotos.mockResolvedValueOnce([{ id: 3 }, { id: 4 }]);
    exportPhotos.mockImplementation(async function* (_list: unknown, sent: number[]) {
      for (const id of [3, 4]) {
        sent.push(id);
        yield { name: `${id}.jpg`, data: Buffer.alloc(10), date: new Date("2026-09-29T00:00:00Z") };
      }
    });
    const reader = (await get("7")).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(stampExport).not.toHaveBeenCalled();
  });

  it("answers a database error before streaming as an error, not a broken zip", async () => {
    listPhotos.mockRejectedValueOnce(new Error("neon down"));
    await expect(get("7")).rejects.toThrow("neon down");
  });

  it("deletes only the finished export named by its token, and refuses bad input", async () => {
    archiveExport.mockResolvedValueOnce(23);
    expect(await (await post({ upto: 7, token: 1790000000123 })).json()).toEqual({ deleted: 23 });
    expect(archiveExport).toHaveBeenCalledWith(1, 7, 1790000000123);
    for (const b of [{ upto: 0, token: 5 }, { upto: 1.5, token: 5 }, { upto: "7", token: 5 }, { upto: 7 }, { upto: 7, token: -1 }]) {
      expect((await post(b)).status).toBe(400);
    }
    expect((await get("abc")).status).toBe(400);
    expect((await get("7", "x")).status).toBe(400);
    expect((await get("7", "0")).status).toBe(400);
  });
});
