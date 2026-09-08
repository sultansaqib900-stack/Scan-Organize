/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { cpus: 2 },
  allowedDevOrigins: ['*.e2b.app'],
};

module.exports = nextConfig;
