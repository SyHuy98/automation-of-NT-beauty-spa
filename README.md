# NT Beauty Spa – Hệ thống phân tour & tính tiền tour cho Kỹ thuật viên

Web app (dùng tốt trên điện thoại, cài được như app – PWA) để:

- **Admin / lễ tân** tạo tour, phân tour theo 4 chế độ (Gợi ý · Tự động · Random cân bằng · Khách chỉ định), hỗ trợ tour 2 KTV chia tiền.
- **KTV** vào/ra ca, nhận/từ chối tour qua popup có chuông + rung + đếm ngược, bấm hoàn thành để **tự cộng tiền tour**.
- **Thuật toán gợi ý** giúp thu nhập giữa các KTV không chênh lệch quá nhiều.
- Thông báo đẩy (Web Push), thông báo nội bộ, chốt lương tháng, xuất Excel, nhật ký thao tác.

Toàn bộ giao diện tiếng Việt, tiền VND, mọi khái niệm "hôm nay / tháng này" tính theo giờ **Asia/Ho_Chi_Minh**.

---

## 1. Kiến trúc

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| Web app | Next.js 16 (App Router) + TypeScript strict + Tailwind CSS 4 | Deploy Vercel (region `sin1` – Singapore) |
| CSDL, Auth, Realtime | Supabase (Postgres 17) – project `nt-beauty-spa` (Singapore) | RLS bật cho mọi bảng |
| Logic ghi quan trọng | Postgres function (`accept_offer`, `complete_tour`…) | Transaction + `SELECT … FOR UPDATE` |
| Hết hạn lời mời | `pg_cron` mỗi 20 giây + client gọi ngay khi đếm về 0 | Không phụ thuộc điện thoại KTV |
| Tự chuyển người kế tiếp | Edge Function `dispatch` (gọi từ Postgres qua `pg_net`) | Dùng chung thuật toán `src/lib/assignment` |
| Web Push | Edge Function `send-push` (VAPID) | Trigger khi có offer mới / thông báo mới |
| Quản lý tài khoản | Edge Function `admin-users` | Dùng service role **có sẵn trong Supabase** |

**Về service role key:** web app trên Vercel **không cần** `SUPABASE_SERVICE_ROLE_KEY`. Mọi thao tác cần quyền admin của Supabase Auth (tạo / khoá / xoá tài khoản, đặt lại mật khẩu) chạy trong Edge Function `admin-users` – nơi Supabase tự cung cấp service role – và function này kiểm tra người gọi là owner. Nhờ vậy key không thể lọt xuống client hay nằm trong biến môi trường Vercel.

### Cấu trúc thư mục

```
src/
  app/                    # route: /login, /admin/*, /ktv/*, /huong-dan
    actions/              # Server Action (đăng nhập, tạo tour – validate Zod ở server)
  components/
    ui/                   # nút, thẻ, dialog, toast… theo design token spa
    admin/                # bảng điều phối, KTV, bảng giá, lịch ca, thông báo, chốt lương, nhật ký, cài đặt
    ktv/                  # màn KTV (mobile-first), popup tour mới
    shared/
  lib/
    assignment/score.ts   # THUẬT TOÁN GỢI Ý (thuần, có unit test)
    earnings/             # chia tiền tour (thuần, có unit test)
    supabase/             # client trình duyệt / server
    hooks/                # useRealtime (tự kết nối lại), useQuery, useNow
    validation/schemas.ts # Zod
    format.ts             # tiền vi-VN, giờ VN
  proxy.ts                # (middleware) làm mới phiên + chặn sai vai trò
  types/database.ts       # sinh bằng supabase gen types
supabase/
  migrations/             # toàn bộ schema, RLS, function, cron
  functions/              # Edge Functions: admin-users, dispatch, send-push (+ _shared)
  tests/smoke.sql         # kiểm thử luồng nghiệp vụ trên DB (tự rollback)
  seed.sql                # dữ liệu demo – CHỈ cho dev local
scripts/create-owner.ts   # tạo tài khoản chủ spa
```

### Mô hình dữ liệu (tóm tắt)

- `profiles` (vai trò `owner | manager | technician`, ca mặc định `morning | afternoon | full | off`), `services` (bảng giá chung), `technician_skills`, `app_settings` (1 dòng).
- `shift_schedules` (lịch ca theo ngày do admin xếp) · `shift_checkins` (vào/ra ca thực tế, ca của ngày).
- `tours` → `tour_items` (chụp giá + thời lượng lúc tạo) → `tour_assignments` (KTV + `share_percent` + `earned_amount`) · `tour_offers` · `tour_audit_logs` · `admin_alerts`.
- `announcements` + `announcement_recipients` · `push_subscriptions` · `payroll_periods` · `earning_disputes`.
- View `earning_lines` / `earnings_daily` / `earnings_monthly`, function `technician_earnings(technician_id, from, to)`.

**Tiền tour của 1 KTV cho 1 tour** = `tổng fee_snapshot × share_percent / 100`, chỉ tính khi tour `completed`, theo ngày hoàn thành (giờ VN). Tour 2 KTV: làm tròn xuống từng phần, phần dư vài đồng dồn cho người tỷ lệ lớn hơn để tổng luôn khớp.

### Thuật toán gợi ý (`src/lib/assignment/score.ts`)

1. **Lọc**: tài khoản hoạt động, đã vào ca, đang rảnh, có đủ kỹ năng cho dịch vụ "cần kỹ năng riêng", chưa từ chối / để hết giờ chính tour đó.
2. **Chấm điểm** (trọng số chỉnh ở Cài đặt): thu nhập hôm nay *chuẩn hoá theo số giờ đã làm* (ca chiều mới vào không bị thiệt), thu nhập tháng so với TB nhóm, phạt lệch do tour chỉ định (vượt TB quá ngưỡng 20%), thời gian rảnh, phạt mạnh nếu sắp hết ca, phạt nhẹ nếu từ chối nhiều.
3. **Giải thích**: "Rảnh 25 phút · Hôm nay 180.000 ₫ (thấp nhất) · Tháng dưới TB 6%".

---

## 2. Chạy local

Yêu cầu: Node 20+ (khuyến nghị 22), npm.

```bash
npm install
cp .env.example .env.local      # điền NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev                      # http://localhost:3000
```

Kiểm tra chất lượng:

```bash
npm run lint
npm run typecheck
npm test                         # Vitest: thuật toán gợi ý + chia tiền
npm run build
```

### Dev với Supabase local (tuỳ chọn)

```bash
npx supabase start               # cần Docker
npx supabase db reset            # chạy toàn bộ migration + seed demo (mật khẩu demo123)
npx supabase functions serve     # chạy Edge Functions
```

Sau đó đặt `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` và anon key in ra từ `supabase start`.

---

## 3. Migration & Edge Functions (production)

Project production: **`vjdzgeaowzhencuespdx`** (Singapore). Toàn bộ migration trong `supabase/migrations/` **đã được chạy**.

Khi có migration mới:

```bash
npx supabase login
npx supabase link --project-ref vjdzgeaowzhencuespdx
npx supabase db push                              # chạy migration chưa áp dụng
npx supabase functions deploy admin-users dispatch send-push
npm run gen:types                                 # cập nhật src/types/database.ts
```

> Nếu sửa `src/lib/assignment/score.ts` thì chạy `npm run sync:edge` (copy sang `supabase/functions/_shared/score.ts`) rồi deploy lại `dispatch`. Test sẽ báo lỗi nếu 2 bản lệch nhau.

Cấu hình nội bộ nằm trong bảng `private.config` (không lộ qua API): `functions_url`, `internal_secret` (tự sinh), cặp khoá VAPID (Edge Function `send-push` tự sinh lần đầu), `vapid_subject`.

Kiểm thử nghiệp vụ trên DB: dán `supabase/tests/smoke.sql` vào SQL Editor – chạy xong tự rollback, thông báo cuối cùng liệt kê kết quả từng bước.

---

## 4. Deploy (Vercel)

- Project Vercel: **`nt-beauty-spa`**, nối repo GitHub `SyHuy98/automation-of-NT-beauty-spa`.
- `main` = production, mỗi PR có bản preview.
- Biến môi trường (Production + Preview + Development): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Không** khai báo service role key trên Vercel.
- Region function: `sin1` (cấu hình trong `vercel.json`) – gần Supabase Singapore.

---

## 5. Tài khoản

- Đăng nhập bằng **tên đăng nhập + mật khẩu**. Bên trong Supabase Auth dùng email ảo `<username>@ntspa.local`.
- Tài khoản chủ spa đầu tiên đã được tạo (`admin`). **Hãy đổi mật khẩu ngay** ở Cài đặt → Đổi mật khẩu.
- Tạo thêm owner: `npm run create-owner -- <ten_dang_nhap> "<Họ tên>"` (cần `SUPABASE_SERVICE_ROLE_KEY` trong `.env.local` ở máy bạn).
- KTV / quản lý do chủ spa tạo trong app (Kỹ thuật viên · Cài đặt → Tài khoản quản lý).

| Vai trò | Quyền |
|---|---|
| owner | Toàn quyền: tài khoản, bảng giá, cài đặt, chốt / mở sổ, xem log |
| manager | Tạo & phân tour, sửa / huỷ tour (có lý do), lịch ca, gửi thông báo, xem dashboard & chốt lương (không chốt được) |
| technician | Chỉ dữ liệu của chính mình |

---

## 6. Hướng dẫn vận hành nhanh cho admin

1. **Nhập bảng giá** (Bảng giá dịch vụ): tên, tiền tour, thời lượng, đánh dấu "cần kỹ năng riêng" cho HIFU / tiêm…
2. **Tạo tài khoản KTV** (Kỹ thuật viên): gán kỹ năng riêng, ca mặc định. Gửi tên đăng nhập + mật khẩu tạm cho KTV.
3. **Xếp lịch ca** (Lịch ca) nếu muốn: bấm ô để đổi Sáng → Chiều → Full → Nghỉ.
4. Hướng dẫn KTV **cài app vào màn hình chính và bật thông báo**: trang `/huong-dan`.
5. Hằng ngày: KTV bấm **Vào ca** → admin **Tạo tour** → theo dõi Bảng điều phối (cảnh báo có âm thanh khi KTV từ chối / hết giờ).
6. Cuối tháng: **Chốt lương** → xử lý báo sai (mở tour để sửa có lý do) → **Xuất Excel** → **Chốt sổ**.

---

## 7. Để dành cho sau (schema đã chừa chỗ)

- Chọn giường khi phân tour (kết nối app quản lý giường Node.js + Socket.IO): thêm bảng `beds` + cột `bed_id` cho `tours`.
- Tạo tour từ Google Sheets "Bảng Đặt Lịch": `tours.external_ref` đã có sẵn để lưu mã lịch hẹn.
- Tip / thưởng riêng: bảng `tour_extras` riêng, không ảnh hưởng cách tính tiền tour hiện tại.
