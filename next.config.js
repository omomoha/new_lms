/** @type {import('next').NextConfig} */
const nextConfig = {
  // Firebase Hosting with Next.js framework-aware deploy reads .next/
  // For static export (firebase deploy --only hosting), uncomment:
  // output: 'export',
  // trailingSlash: true,
  // Keep Firebase + gRPC/protobuf out of the server bundle so the
  // Firebase web-frameworks (SSR) deploy doesn't try to webpack protobufjs.
  experimental: {
    serverComponentsExternalPackages: [
      "firebase", "@firebase/firestore", "@firebase/auth", "@firebase/storage",
      "@grpc/grpc-js", "@grpc/proto-loader", "protobufjs", "long",
    ],
  },
  images: {
    // Allow Firebase Storage domains
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Don't let browsers MIME-sniff responses
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The app never needs to be framed by other origins (clickjacking)
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Don't leak full URLs (e.g. signed-URL query strings) cross-origin
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Lock down powerful browser features the app doesn't use
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS only (Firebase Hosting serves HTTPS; harmless on localhost)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
