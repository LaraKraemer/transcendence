import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
};

// Registers i18n/request.ts as the per-request locale and message source.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
