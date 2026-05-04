import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['165.245.128.87', 'preblooming-unlabelled-abby.ngrok-free.dev'],
  async rewrites() {
    return [
      {
        source: '/api/video',
        destination: 'http://127.0.0.1:8080/video',
      },
      {
        source: '/api/snapshot',
        destination: 'http://127.0.0.1:8080/snapshot',
      },
    ];
  },
};

export default nextConfig;
