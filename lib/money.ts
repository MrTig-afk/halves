// Money is integer cents everywhere; this is the only place it becomes text, and back.
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// What a person types into a price box -> cents, or null if it is not an amount.
// Accepts "12", "12.5", "12.50", "$12.50", "-2", "-$2.00"; at most two decimals.
export function parseCents(text: string): number | null {
  const m = text.trim().replace(/^(-?)\$/, "$1").match(/^(-?)(\d{1,6})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}
