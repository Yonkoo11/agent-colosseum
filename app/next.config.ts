import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/agent-colosseum",
  images: { unoptimized: true },
};

export default nextConfig;
