import NotFound from "@/app/not-found";

export { generateMetadata } from "@/app/not-found";

/** `notFound()` in a protected page, e.g. a missing account: the 404 page inside the app shell. */
export default function ProtectedNotFound() {
  return <NotFound inAppShell />;
}
