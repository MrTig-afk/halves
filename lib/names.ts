// How people and dates read on screen. Pure, so both server pages and client screens use them.

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const initial = (name: string) => name.trim().charAt(0).toUpperCase();

// The two roommates live in Australia; "today" and settlement dates are read on their clock, not
// the server's (which runs in UTC).
const TZ = "Australia/Sydney";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A bill date is a calendar date (YYYY-MM-DD) with no time zone: read it as written.
export function dayMonth(date: string): { day: number; month: string } {
  const [, m, d] = date.split("-").map(Number);
  return { day: d, month: MONTHS[m - 1] };
}
export const shortDate = (date: string) => {
  const { day, month } = dayMonth(date);
  return `${day} ${month}`;
};

// A moment (timestamptz text) as a calendar date on the roommates' clock.
export const localDate = (moment: string) => new Date(moment).toLocaleDateString("en-CA", { timeZone: TZ });
export const isToday = (moment: string, now = new Date()) => localDate(moment) === now.toLocaleDateString("en-CA", { timeZone: TZ });

// "29 Sep, 6:02 pm": when a date or total was changed, on the roommates' clock. Built from parts,
// not en-AU, whose short September is "Sept".
export const editedAt = (moment: string): string => {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(moment))) p[x.type] = x.value;
  return `${p.day} ${MONTHS[Number(p.month) - 1]}, ${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}`;
};

// Who had an item, in the viewer's words (2.6 order: the viewer first, then the people as given,
// which is id order). null: a discount or surcharge has no label.
export function itemLabel(set: number[] | null, people: { id: number; name: string }[], me: number): string | null {
  if (!set?.length) return null;
  if (people.every((p) => set.includes(p.id))) return "everyone";
  const who = people.filter((p) => set.includes(p.id)).sort((a, b) => Number(b.id === me) - Number(a.id === me));
  if (who.length === 1) return who[0].id === me ? "yours" : `${firstName(who[0].name)}'s`;
  return who.map((p) => (p.id === me ? "You" : firstName(p.name))).join(", ");
}
