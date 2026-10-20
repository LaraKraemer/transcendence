import { NewTransactionButton } from "@/components/transactions/transaction-form-dialog";
import { LiveStatusProvider } from "@/components/ui/live-status";
import { getAccounts, getCategories, getCurrencies } from "@/lib/dal";

export async function NewTransactionFab() {
  const data = await Promise.all([getAccounts(), getCategories(), getCurrencies()]).catch((error) => {
    console.error("NewTransactionFab: loading failed:", error);
    return null;
  });
  if (!data || data[0].length === 0) return null;

  const [accounts, categories, currencies] = data;
  const minorUnits = new Map(currencies.map((currency) => [currency.code, currency.minorUnit]));
  return (
    <LiveStatusProvider>
      <NewTransactionButton
        variant="fab"
        accounts={accounts.map(({ id, name, currencyCode }) => ({
          id,
          name,
          currencyCode,
          minorUnit: minorUnits.get(currencyCode) ?? 2,
        }))}
        categories={categories.map(({ id, name, kind }) => ({ id, name, kind }))}
      />
    </LiveStatusProvider>
  );
}
