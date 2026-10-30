import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tesseract and Prisma stay server-side and are loaded from node_modules at runtime.
  serverExternalPackages: ["tesseract.js", "@prisma/client"],
  poweredByHeader: false,
};

export default nextConfig;
