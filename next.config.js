/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "firebase", "@firebase/firestore", "@firebase/auth", "@firebase/storage",
      "@grpc/grpc-js", "@grpc/proto-loader", "protobufjs", "long",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
    ],
  },
};
module.exports = nextConfig;
