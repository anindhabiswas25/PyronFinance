/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The lockfile lives at the workspace root, one level up, so tracing has to
  // start there rather than in this package.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,

  eslint: {ignoreDuringBuilds: true},
};

export default nextConfig;
