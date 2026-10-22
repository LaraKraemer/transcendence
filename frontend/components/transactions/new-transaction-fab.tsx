import { NewTransactionButton } from "@/components/transactions/transaction-form-dialog";
import { LiveStatusProvider } from "@/components/ui/live-status";
import { getAccounts, getCategories, getCurrencies } from "@/lib/dal";

export async function NewTransactionFab() {
  // ponytail: AppShell renders this on every protected page, so each page load makes three extra API
  // calls just for the FAB (cache() only dedupes them within one render). Upgrade path: load the data
  // lazily when the FAB is first opened.
  const data = await Promise.all([getAccounts(), getCategories(), getCurrencies()]).catch((error) => {
    console.error("NewTransactionFab: loading failed:", error);
    return null;
  });
  if (!data || data[0].length === 0) return null;

  const [accounts, categories, currencies] = data;
  const minorUnits = new Map(currencies.map((currency) => [currency.code, currency.minorUnit]));
  const accountOptions = accounts.map(({ id, name, currencyCode }) => ({
    id,
    name,
    currencyCode,
    minorUnit: minorUnits.get(currencyCode) ?? 2,
  }));
  return (
    <LiveStatusProvider>
      <NewTransactionButton
        variant="fab"
        accounts={accountOptions}
        allAccounts={accountOptions}
        categories={categories.map(({ id, name, types }) => ({ id, name, types }))}
      />
    </LiveStatusProvider>
  );
}
