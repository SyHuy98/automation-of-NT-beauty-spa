import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ứng dụng gần như toàn bộ là dữ liệu theo phiên đăng nhập + realtime, nên
  // dùng render động truyền thống thay vì Cache Components.
  cacheComponents: false,
  poweredByHeader: false,
  images: {
    // Ảnh đại diện lưu ở Supabase Storage (bucket công khai `avatars`)
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/avatars/**" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // Service worker phải luôn lấy bản mới nhất
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
