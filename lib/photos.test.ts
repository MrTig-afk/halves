import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ query }));
const { exportPhotos } = await import("./photos");

const list = [1, 2, 3].map((id) => ({ id, bill_id: id, bill_date: "2026-09-29", description: "Coles", taken: "2026-09-29T23:02:00" }));

beforeEach(() => {
  query.mockReset();
  // Photo 2 was archived by another export meanwhile.
  query.mockImplementation(async (_sql: string, params: unknown[]) =>
    (params[0] as number[]).filter((id) => id !== 2).map((id) => ({ id, jpeg: Buffer.from([id]) })),
  );
});

describe("exportPhotos", () => {
  it("hands over the listed photos still here, named and noted as sent", async () => {
    const sent: number[] = [];
    const names: string[] = [];
    for await (const e of exportPhotos(list, sent)) names.push(e.name);
    expect(names).toEqual(["2026-09-29_1_Coles.jpg", "2026-09-29_3_Coles.jpg"]);
    expect(sent).toEqual([1, 3]);
    expect(query).toHaveBeenCalledTimes(1); // ten per round trip
  });
});
