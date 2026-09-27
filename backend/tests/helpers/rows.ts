import { getTableColumns, type Table } from "drizzle-orm";

export function row(table: Table, values: Record<string, unknown>) {
  return Object.keys(getTableColumns(table)).map((key) => values[key] ?? null);
}
