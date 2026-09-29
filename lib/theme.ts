// This phone's Appearance: System (no cookie), Light or Dark. A cookie rather than local storage,
// so the server renders the right theme and status-bar colour on every page with no flash.
export type Theme = "system" | "light" | "dark";
export const THEME_COOKIE = "halves-theme";
export const THEME_COLOR = { light: "#1CC29F", dark: "#1B1F21" } as const;

export const readTheme = (value: string | undefined): Theme => (value === "light" || value === "dark" ? value : "system");
