const toneClasses = {
  danger: "bg-danger-bg text-destructive",
  success: "bg-success-bg text-success",
};

/**
 * Box at the top of a form: an error (a wrong password, the server is down) or, with
 * `tone="success"`, a result such as "Password changed". Both use role="alert", which
 * screen readers announce when the box appears, also right after a navigation.
 */
export function FormAlert({ message, tone = "danger" }: { message: string | null; tone?: keyof typeof toneClasses }) {
  if (!message) return null;
  return (
    <div role="alert" className={`mb-[18px] rounded-[11px] px-[15px] py-3 text-label font-medium ${toneClasses[tone]}`}>
      {message}
    </div>
  );
}
