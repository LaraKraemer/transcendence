import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Profile photos go through a server action: 5 MiB (the backend's cap) plus multipart overhead.
      bodySizeLimit: "6mb",
    },
  },
};

// Registers i18n/request.ts as the per-request locale and message source.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
