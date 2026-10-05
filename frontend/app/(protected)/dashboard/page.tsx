// Placeholder page so /dashboard resolves and the (protected) guard is testable.
// The real dashboard is delivered in a later frontend issue.
export default function DashboardPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
    </main>
  );
}
