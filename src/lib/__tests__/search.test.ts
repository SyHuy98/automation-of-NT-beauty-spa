import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeVi } from "../search";

describe("tìm dịch vụ không dấu", () => {
  it("bỏ dấu, chữ thường, đ → d", () => {
    expect(normalizeVi("  Bi Nách   Hậu ")).toBe("bi nach hau");
    expect(normalizeVi("Đắp mặt nạ")).toBe("dap mat na");
  });

  it("gõ không dấu / có dấu / một phần đều tìm được", () => {
    expect(matchesSearch("Bi nách hậu", "nach")).toBe(true);
    expect(matchesSearch("Bi nách hậu", "nách")).toBe(true);
    expect(matchesSearch("Bi nách hậu", "hau nach")).toBe(true);
    expect(matchesSearch("Gội đầu dưỡng sinh", "goi dau")).toBe(true);
    expect(matchesSearch("Gội đầu dưỡng sinh", "massage")).toBe(false);
  });

  it("gõ chữ cái đầu", () => {
    expect(matchesSearch("Bi nách hậu", "bnh")).toBe(true);
    expect(matchesSearch("Gội đầu dưỡng sinh", "gdds")).toBe(true);
    expect(matchesSearch("Massage cổ vai gáy", "cvg")).toBe(true);
    expect(matchesSearch("Bi nách hậu", "x")).toBe(false);
  });

  it("ô trống thì hiện tất cả", () => {
    expect(matchesSearch("Bất kỳ", "")).toBe(true);
  });
});
