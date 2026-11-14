export const COVER_STYLES = ["field", "rings"] as const;
export type CoverStyle = (typeof COVER_STYLES)[number];
