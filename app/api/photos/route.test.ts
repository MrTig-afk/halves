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
const exportRoute = await import("./export/route");
const exportZip = exportRoute.POST;
const { POST: archive } = await import("./archive/route");

const admin = { id: 1, name: "Kaushik", role: "admin" };
const member = { id: 4, name: "Soham", role: "member" };
const exportPost = (upto: string, t = "1790000000000") => {
  const form = new FormData();
  form.append("upto", upto);
  form.append("t", t);
  return exportZip(new Request("http://x/api/photos/export", { method: "POST", body: form }));
};
const post = (body: unknown) => archive(new Request("http://x/api/photos/archive", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  currentPerson.mockResolvedValue(admin);
});

describe("photo export", () => {
  it("starts only with a POST: there is no GET export", () => {
    expect("GET" in exportRoute).toBe(false);
  });

  it("answers a POST with no form at all as a bad request", async () => {
    expect((await exportZip(new Request("http://x/api/photos/export", { method: "POST" }))).status).toBe(400);
    expect((await exportZip(new Request("http://x/api/photos/export", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  it("is for the admin only, on both routes", async () => {
    currentPerson.mockResolvedValue(member);
    expect((await exportPost("5")).status).toBe(403);
    expect((await post({ upto: 5 })).status).toBe(403);
    currentPerson.mockResolvedValue(null);
    expect((await exportPost("5")).status).toBe(401);
    expect(listPhotos).not.toHaveBeenCalled();
    expect(archiveExport).not.toHaveBeenCalled();
  });

  it("lists the admin's photos up to the id first, then streams them as a zip under the export's token", async () => {
    listPhotos.mockResolvedValueOnce([{ id: 3 }]);
    exportPhotos.mockImplementation(async function* (_me: unknown, _list: unknown, sent: number[]) {
      sent.push(3);
      yield { name: "a.jpg", data: Buffer.from("x"), date: new Date("2026-09-29T00:00:00Z") };
    });
    const res = await exportPost("7", "1790000000123");
    expect(stampExport).not.toHaveBeenCalled();
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="halves-photos-\d{4}-\d{2}\.zip"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(listPhotos).toHaveBeenCalledWith(1, 7);
    expect(exportPhotos).toHaveBeenCalledWith(1, [{ id: 3 }], [3]);
    expect(stampExport).toHaveBeenCalledWith(1, [3], 1790000000123); // only once the directory was read
  });

  it("stamps nothing when the download is cancelled before the end", async () => {
    listPhotos.mockResolvedValueOnce([{ id: 3 }, { id: 4 }]);
    exportPhotos.mockImplementation(async function* (_me: unknown, _list: unknown, sent: number[]) {
      for (const id of [3, 4]) {
        sent.push(id);
        yield { name: `${id}.jpg`, data: Buffer.alloc(10), date: new Date("2026-09-29T00:00:00Z") };
      }
    });
    const reader = (await exportPost("7")).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(stampExport).not.toHaveBeenCalled();
  });

  it("answers a database error before streaming as an error, not a broken zip", async () => {
    listPhotos.mockRejectedValueOnce(new Error("neon down"));
    await expect(exportPost("7")).rejects.toThrow("neon down");
  });

  it("deletes only the finished export named by its token, and refuses bad input", async () => {
    archiveExport.mockResolvedValueOnce(23);
    expect(await (await post({ upto: 7, token: 1790000000123 })).json()).toEqual({ deleted: 23 });
    expect(archiveExport).toHaveBeenCalledWith(1, 7, 1790000000123);
    for (const b of [{ upto: 0, token: 5 }, { upto: 1.5, token: 5 }, { upto: "7", token: 5 }, { upto: 7 }, { upto: 7, token: -1 }]) {
      expect((await post(b)).status).toBe(400);
    }
    expect((await exportPost("abc")).status).toBe(400);
    expect((await exportPost("7", "x")).status).toBe(400);
    expect((await exportPost("7", "0")).status).toBe(400);
  });
});
