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
};

module.exports = nextConfig;
