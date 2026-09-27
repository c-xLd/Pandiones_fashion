import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module; keep it out of the server bundle.
  serverExternalPackages: ["sharp"],
  experimental: {
    serverActions: {
      // Product files are uploaded directly to Supabase Storage via signed
      // upload URLs, so server actions only carry form fields.
      bodySizeLimit: "2mb",
    },
  },
  images: {
    // Private assets are served through short-lived signed URLs; we render
    // them with <img> and do not proxy them through the Next image optimizer.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
