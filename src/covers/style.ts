export const COVER_STYLES = ["field", "rings", "orb", "waves", "rays", "tiles"] as const;
export type CoverStyle = (typeof COVER_STYLES)[number];
/** Styles drawn without album art. */
export type AbstractStyle = Exclude<CoverStyle, "field">;
