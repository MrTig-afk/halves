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
