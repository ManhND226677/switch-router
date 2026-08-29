const proxyClientMaxBodySize = process.env.SWITCH_ROUTER_PROXY_CLIENT_MAX_BODY_SIZE
  || process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE
  || "128mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR lets analysis builds write to e.g. .next-analyze while the
  // production standalone server holds locks on .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite"],
  outputFileTracingExcludes: {
    "*": ["./gitbook/**/*"]
  },
  images: {
    unoptimized: true
  },
  env: {},
  experimental: {
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
    // Cache fetch responses across HMR refreshes for faster dev reloads.
    serverComponentsHmrCache: true,
    // Tree-shake heavy barrel imports to cut compile + bundle size
    optimizePackageImports: ["@dnd-kit/core", "@dnd-kit/sortable"],
  },
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // Exclude non-source dirs from watcher to reduce inotify load
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 300,
      ignored: /[\\/](node_modules|\.git|logs|\.next|gitbook|open-sse\.old|tests|docs)[\\/]/,
    };
    return config;
  },
  async rewrites() {
    return [
      // NOTE: the legacy /v1/v1 double-prefix compat rewrite was removed in
      // 0.9.0 — clients must use the canonical /v1 base URL (no doubled /v1).
      // NOTE: the /codex, /responses and /v1beta client surfaces were removed
      // in 0.10.0 — /v1 is the ONE public gateway surface (OpenAI-compatible,
      // Anthropic Messages and Responses API all live under /v1). Codex CLI is
      // configured with base_url <origin>/v1 + wire_api "responses".
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
