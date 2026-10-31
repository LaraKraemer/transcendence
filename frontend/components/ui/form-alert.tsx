/** Red box at the top of the form, e.g. for a wrong password or when the server is down. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-[18px] rounded-[11px] bg-danger-bg px-[15px] py-3 text-label font-medium text-destructive">
      {message}
    </div>
  );
}
