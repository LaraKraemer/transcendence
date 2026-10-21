import { NotFoundStatus } from "@/components/status-page";

export { generateMetadata } from "@/app/not-found";

/**
 * `notFound()` in a protected page, e.g. a missing account. Without this file Next.js renders
 * app/not-found.tsx inside the protected layout, which would show the app shell twice.
 */
export default function ProtectedNotFound() {
  return <NotFoundStatus standalone={false} />;
}
