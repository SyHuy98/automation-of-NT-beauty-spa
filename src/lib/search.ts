/** Bỏ dấu tiếng Việt + chữ thường để tìm kiếm: "Bi Nách Hậu" → "bi nach hau" */
export function normalizeVi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Khớp tìm kiếm không dấu: mọi từ gõ vào đều phải có trong tên ("nach hau" ~ "Bi nách hậu"),
 * hoặc gõ chữ cái đầu của các từ liền nhau ("bnh" ~ "Bi nách hậu", "cvg" ~ "Massage cổ vai gáy").
 */
export function matchesSearch(name: string, query: string): boolean {
  const q = normalizeVi(query);
  if (!q) return true;
  const n = normalizeVi(name);
  if (q.split(" ").every((w) => n.includes(w))) return true;
  const initials = n
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("");
  return !q.includes(" ") && q.length >= 2 && initials.includes(q);
}
