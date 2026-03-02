import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "ws" is a Node-only WebSocket package used by @solana/web3.js.
  // Marking it external prevents Next.js from trying to bundle it for the browser.
  serverExternalPackages: ["ws"],

  // Allow Next.js <Image /> to optimize images from external hosts.
  // Add any icon/image domains you use in your Action GET responses here.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.freepik.com",
      },
    ],
  },

  // Inject HTTP response headers required by the Solana Actions / Blinks spec.
  // Wallet clients check for these on every /api/* and /actions.json response.
  async headers() {
    return [
      {
        // Apply to all API routes and the actions.json discovery endpoint
        source: "/(api|actions.json)(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization, Accept-Encoding",
          },
          // Tells blink clients which Actions spec version this endpoint targets
          { key: "X-Action-Version", value: "2.4" },
          // Tells blink clients which blockchain this Action targets (Solana devnet)
          { key: "X-Blockchain-Ids", value: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" },
        ],
      },
    ];
  },
};

export default nextConfig;
