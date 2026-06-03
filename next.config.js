/** @type {import('next').NextConfig} */
const nextConfig = {
  // Firebase Hosting with Next.js framework-aware deploy reads .next/
  // For static export (firebase deploy --only hosting), uncomment:
  // output: 'export',
  // trailingSlash: true,
  experimental: {
    // serverActions are enabled by default in Next.js 14
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
