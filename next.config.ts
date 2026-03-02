import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "ws" is a Node-only WebSocket package used by @solana/web3.js.
  // Marking it external prevents Next.js from trying to bundle it for the browser.
  serverExternalPackages: ["ws"],

  // The @solana/kit v5 ecosystem ships ESM-only packages whose module-level
  // constants (e.g. the base58 alphabet) lose scope when Turbopack concatenates
  // modules — producing "alphabet4 is not defined" at runtime.
  // Adding them to transpilePackages makes Next.js compile them through its own
  // SWC pipeline, which preserves module scope correctly.
  transpilePackages: [
    "@solana/accounts",
    "@solana/addresses",
    "@solana/assertions",
    "@solana/client",
    "@solana/codecs",
    "@solana/codecs-core",
    "@solana/codecs-data-structures",
    "@solana/codecs-numbers",
    "@solana/codecs-strings",
    "@solana/errors",
    "@solana/functional",
    "@solana/instruction-plans",
    "@solana/instructions",
    "@solana/keys",
    "@solana/kit",
    "@solana/nominal-types",
    "@solana/options",
    "@solana/programs",
    "@solana/promises",
    "@solana/react-hooks",
    "@solana/rpc",
    "@solana/rpc-api",
    "@solana/rpc-parsed-types",
    "@solana/rpc-spec",
    "@solana/rpc-spec-types",
    "@solana/rpc-transformers",
    "@solana/rpc-transport-http",
    "@solana/rpc-types",
    "@solana/signers",
    "@solana/transactions",
  ],

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
