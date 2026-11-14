import { z } from "zod";
import { CONFIDENCE, GENRES, MOODS } from "./vocabulary";

const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

const distinct = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length, "values must be distinct");

export const tagInputSchema = z.strictObject({
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/),
  genres: distinct(z.enum(GENRES)),
  subgenre: z.string().trim().min(1).max(60).nullable().optional(),
  moods: distinct(z.enum(MOODS)),
  energy: z.number().int().min(1).max(5),
  valence: z.number().int().min(1).max(5),
  language: z
    .string()
    .refine((code) => code === "instrumental" || (/^[a-z]{2}$/.test(code) && languageNames.of(code) !== undefined), "ISO 639-1 code or 'instrumental'"),
  model: z.string().trim().min(1).max(100),
  confidence: z.enum(CONFIDENCE),
  taggedAt: z.iso.datetime().optional(),
});

export const tagBulkSchema = z.strictObject({ tags: z.array(tagInputSchema).min(1).max(500) });

export type TagInput = z.infer<typeof tagInputSchema>;
