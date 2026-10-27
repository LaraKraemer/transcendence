import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // An account's transactions moved from /accounts/:id/transactions to /transactions?accountId=:id.
  // The query (e.g. ?type=income) is passed through.
  async redirects() {
    return [
      {
        source: "/accounts/:accountId/transactions",
        destination: "/transactions?accountId=:accountId",
        permanent: false,
      },
    ];
  },
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
