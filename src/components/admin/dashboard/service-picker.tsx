"use client";

import { Check, ChevronDown, Search, Sparkle, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Money } from "@/components/ui/misc";
import { formatMinutes } from "@/lib/format";
import { matchesSearch } from "@/lib/search";
import type { ServiceRow } from "@/types/app";

/**
 * Chọn 1 hoặc nhiều dịch vụ, tự cộng tổng tiền tour + thời lượng.
 * Ô tìm kiếm có gợi ý xổ xuống (gõ không dấu / chữ cái đầu đều được), dịch vụ
 * đã chọn hiện thành thẻ phía trên – vẫn gọn khi bảng giá có vài chục dịch vụ.
 */
export function ServicePicker({
  services,
  selected,
  onChange,
  error,
}: {
  services: ServiceRow[];
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const chosen = selected.map((id) => services.find((s) => s.id === id)).filter((s): s is ServiceRow => !!s);
  const total = chosen.reduce((sum, s) => sum + s.tour_fee, 0);
  const minutes = chosen.reduce((sum, s) => sum + s.duration_minutes, 0);
  const results = useMemo(() => services.filter((s) => matchesSearch(s.name, query)), [services, query]);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  // Bấm ra ngoài thì đóng danh sách
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Giữ dòng đang chọn bằng phím trong tầm nhìn
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (services.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-champagne p-4 text-sm text-mocha">
        Chưa có dịch vụ nào. Chủ spa cần nhập bảng giá ở mục <strong>Bảng giá dịch vụ</strong> trước.
      </p>
    );
  }

  const pick = (s: ServiceRow) => {
    toggle(s.id);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(Math.min(activeIndex + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      if (open && results[activeIndex]) {
        e.preventDefault();
        pick(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      // hộp thoại bỏ qua Esc khi danh sách đang mở (data-esc-local)
      if (open) setOpen(false);
    } else if (e.key === "Backspace" && !query && selected.length > 0) {
      onChange(selected.slice(0, -1));
    }
  };

  return (
    <div ref={rootRef}>
      {chosen.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Dịch vụ đã chọn">
          {chosen.map((s) => (
            <li
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-gold-strong bg-champagne/40 py-1 pl-3 pr-1 text-sm text-espresso"
            >
              <span className="font-medium">{s.name}</span>
              {s.requires_skill ? <Sparkle className="h-3 w-3 text-gold-strong" aria-label="Cần kỹ năng riêng" /> : null}
              <span className="text-mocha">
                · <Money value={s.tour_fee} />
              </span>
              <button
                type="button"
                onClick={() => toggle(s.id)}
                className="rounded-full p-1 text-mocha hover:bg-white/80 hover:text-busy-ink"
                aria-label={`Bỏ ${s.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className={cn(
          "flex h-11 items-center gap-2 rounded-xl border bg-white/90 px-3 transition-colors focus-within:border-gold-strong focus-within:ring-2 focus-within:ring-gold/30",
          error ? "border-busy/60" : "border-champagne",
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-mocha" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          aria-label="Tìm và chọn dịch vụ"
          data-esc-local={open}
          placeholder={chosen.length ? "Thêm dịch vụ…" : "Gõ tên dịch vụ, vd: bi nach (không dấu cũng được)"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-espresso placeholder:text-taupe"
          // khung ngoài đã có viền focus (focus-within) – bỏ viền focus chung của ô nhập
          style={{ outline: "none" }}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="rounded-md p-1 text-mocha hover:bg-cream"
          aria-label={open ? "Đóng danh sách dịch vụ" : "Mở danh sách dịch vụ"}
          tabIndex={-1}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Dịch vụ"
          className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-champagne bg-white p-1 shadow-soft"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-mocha">Không tìm thấy dịch vụ “{query}”</li>
          ) : (
            results.map((s, i) => {
              const on = selected.includes(s.id);
              return (
                <li
                  key={s.id}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={on}
                  // giữ focus ở ô tìm kiếm khi bấm chọn
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(s)}
                  onPointerMove={() => i !== activeIndex && setActive(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2",
                    i === activeIndex ? "bg-champagne/40" : "",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                      on ? "border-gold-strong bg-gold-strong text-white" : "border-taupe",
                    )}
                    aria-hidden="true"
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-espresso">
                    {s.name}
                    {s.requires_skill ? <Sparkle className="ml-1 inline h-3.5 w-3.5 text-gold-strong" aria-label="Cần kỹ năng riêng" /> : null}
                  </span>
                  <span className="shrink-0 text-sm text-mocha">
                    <Money value={s.tour_fee} /> · {s.duration_minutes}′
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream/70 px-4 py-2.5">
        <span className="text-sm text-mocha">
          {chosen.length} dịch vụ · {minutes ? formatMinutes(minutes) : "0 phút"}
        </span>
        <span className="text-sm text-mocha">
          Tổng tiền tour: <Money value={total} className="text-base font-semibold text-espresso" />
        </span>
      </div>
      {error ? <p className="mt-1 text-sm text-busy-ink">{error}</p> : null}
      <p className="mt-1 text-xs text-mocha">
        <Sparkle className="inline h-3 w-3 text-gold-strong" /> = dịch vụ cần kỹ năng riêng (chỉ KTV được gán mới được gợi ý). Phím ↑ ↓ để
        chọn, Enter để thêm.
      </p>
    </div>
  );
}
