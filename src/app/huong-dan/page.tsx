import type { Metadata } from "next";
import Link from "next/link";
import { LeafOrnament, Logo } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Hướng dẫn" };

export default function GuidePage() {
  return (
    <main className="relative mx-auto max-w-2xl px-4 py-8">
      <LeafOrnament className="pointer-events-none absolute -right-10 -top-6 h-48 w-48" />
      <Link href="/" className="inline-block">
        <Logo />
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-semibold text-espresso">Hướng dẫn sử dụng</h1>
      <div className="mt-2 h-px w-16 bg-gold" />

      <section id="thong-bao" className="mt-8 space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-espresso">Bật thông báo tour mới</h2>
        <p className="text-mocha">
          Bật thông báo để điện thoại reo khi có tour mới kể cả khi đang tắt màn hình. Mỗi điện thoại chỉ cần làm 1 lần.
        </p>

        <div className="rounded-2xl border border-champagne bg-white/80 p-5">
          <h3 className="text-lg font-semibold text-espresso">iPhone (iOS 16.4 trở lên)</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] text-espresso">
            <li>
              Mở trang web của spa bằng <strong>Safari</strong> (không dùng Zalo / Chrome).
            </li>
            <li>
              Bấm nút <strong>Chia sẻ</strong> (ô vuông có mũi tên lên) → chọn <strong>Thêm vào MH chính</strong> → <strong>Thêm</strong>.
            </li>
            <li>
              Thoát Safari, mở app <strong>NT Spa</strong> từ biểu tượng mới trên màn hình chính rồi đăng nhập.
            </li>
            <li>
              Vào <strong>Tài khoản</strong> → <strong>Bật thông báo</strong> → chọn <strong>Cho phép</strong>.
            </li>
            <li>
              Kiểm tra: Cài đặt → Thông báo → NT Spa → bật <strong>Cho phép thông báo</strong>, âm thanh, và tắt chế độ Tập trung / Không làm
              phiền trong giờ làm.
            </li>
          </ol>
          <p className="mt-2 text-sm text-mocha">Kiểm tra phiên bản iOS: Cài đặt → Cài đặt chung → Giới thiệu → Phiên bản iOS.</p>
        </div>

        <div className="rounded-2xl border border-champagne bg-white/80 p-5">
          <h3 className="text-lg font-semibold text-espresso">Android</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] text-espresso">
            <li>
              Mở trang web bằng <strong>Chrome</strong>, đăng nhập.
            </li>
            <li>
              Bấm menu <strong>⋮</strong> → <strong>Cài đặt ứng dụng</strong> (hoặc <strong>Thêm vào màn hình chính</strong>).
            </li>
            <li>
              Mở app từ biểu tượng → <strong>Tài khoản</strong> → <strong>Bật thông báo</strong> → <strong>Cho phép</strong>.
            </li>
            <li>
              Nếu không reo: Cài đặt điện thoại → Ứng dụng → Chrome / NT Spa → Thông báo → bật hết; tắt <strong>Tối ưu pin</strong> cho Chrome.
            </li>
          </ol>
        </div>

        <div className="rounded-2xl border border-gold/50 bg-champagne/30 p-5 text-[15px] text-espresso">
          <p className="font-semibold">Mẹo để không lỡ tour</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Khi đang trong ca, nên để app mở – có chuông + rung và popup toàn màn hình ngay lập tức.</li>
            <li>Chạm vào màn hình app 1 lần sau khi mở để điện thoại cho phép phát âm thanh.</li>
            <li>Nếu báo “Mất kết nối”, kiểm tra Wi‑Fi / 4G – app sẽ tự kết nối lại.</li>
          </ul>
        </div>
      </section>

      <section id="ktv" className="mt-10 space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-espresso">Kỹ thuật viên</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px] text-espresso">
          <li>Tới spa bấm <strong>Vào ca</strong> và chọn ca (sáng / chiều / full). Chỉ khi đã vào ca mới được phân tour.</li>
          <li>
            Có tour mới: popup hiện ra kèm đồng hồ đếm ngược. Bấm <strong>Chấp nhận</strong> hoặc <strong>Từ chối</strong> (phải chọn lý do).
            Hết giờ không trả lời thì tour tự chuyển đi.
          </li>
          <li>
            Làm xong bấm <strong>Hoàn thành</strong> – tiền tour tự cộng vào Hôm nay / Tháng này.
          </li>
          <li>
            Thấy tiền sai? Vào <strong>Thu nhập</strong> → <strong>Báo sai</strong> trên tour đó (hoặc cả tháng).
          </li>
          <li>Về thì bấm <strong>Ra ca</strong>.</li>
        </ol>
      </section>

      <section id="admin" className="mt-10 space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-espresso">Quản lý / lễ tân</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px] text-espresso">
          <li>
            <strong>Tạo tour</strong> ở Bảng điều phối: nhập khách, chọn dịch vụ, chọn chế độ phân:
            <ul className="mt-1 list-[circle] space-y-1 pl-5">
              <li>
                <strong>Gợi ý</strong>: hệ thống đưa top 3 KTV kèm lý do, bạn bấm <em>Gửi</em>.
              </li>
              <li>
                <strong>Tự động</strong>: gửi người phù hợp nhất; ai từ chối / hết giờ thì tự chuyển người tiếp theo.
              </li>
              <li>
                <strong>Random cân bằng</strong>: chọn ngẫu nhiên có trọng số trong nhóm phù hợp nhất.
              </li>
              <li>
                <strong>Khách chỉ định</strong>: chọn đích danh; KTV đang bận thì tour chờ và tự gửi khi KTV rảnh.
              </li>
            </ul>
          </li>
          <li>Ô “Cần xử lý” + âm báo: KTV từ chối / không phản hồi tour Gợi ý hoặc Chỉ định → bấm “Chọn lại KTV”.</li>
          <li>Sửa / huỷ / đổi KTV luôn phải nhập lý do và được ghi vào Nhật ký thao tác.</li>
          <li>
            Cuối tháng: <strong>Chốt lương</strong> → xử lý báo sai → <strong>Xuất Excel</strong> → <strong>Chốt sổ</strong> (chỉ chủ spa). Tháng đã
            chốt không sửa được tour.
          </li>
        </ul>
      </section>

      <p className="mt-10 text-center">
        <Link href="/" className="font-semibold text-gold-strong underline underline-offset-4">
          Quay lại ứng dụng
        </Link>
      </p>
    </main>
  );
}
