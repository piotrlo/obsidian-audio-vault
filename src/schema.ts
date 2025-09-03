/**
 * Runtime validation schemas using Zod.
 * Provides type-safe parsing and validation of external data.
 */

import { z } from 'zod';
import type { AudioManifest } from './types';

/**
 * Schema for validating AudioManifest objects.
 * Ensures fetchedParts array is sorted and contains unique values.
 */
export const manifestSchema = z.object({
  version: z.number().int().min(1),
  ext: z.string().min(1).regex(/^[a-z0-9]+$/i, 'File extension must be alphanumeric'),
  totalParts: z.number().int().min(1).max(10000),
  fetchedParts: z.array(z.number().int().min(1))
    .refine((arr) => {
      // Check if array is sorted and unique
      const sorted = [...arr].sort((a, b) => a - b);
      return JSON.stringify(arr) === JSON.stringify(sorted) && 
             new Set(arr).size === arr.length;
    }, 'fetchedParts must be sorted and contain unique values'),
  mergedUntil: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
}).refine((data) => {
  // mergedUntil should not exceed the highest fetchedPart
  const maxFetched = data.fetchedParts.length > 0 ? Math.max(...data.fetchedParts) : 0;
  return data.mergedUntil <= maxFetched;
}, 'mergedUntil cannot exceed highest fetched part')
.refine((data) => {
  // All fetched parts should be within totalParts range
  return data.fetchedParts.every(part => part <= data.totalParts);
}, 'All fetched parts must be within totalParts range');

/**
 * Schema for validating PrefetchResult objects.
 */
export const prefetchResultSchema = z.object({
  idx: z.number().int().min(0),
  buffer: z.instanceof(ArrayBuffer),
  mime: z.string().min(1),
});

/**
 * Schema for validating basic file extension strings.
 */
export const fileExtensionSchema = z.string()
  .min(1)
  .max(10)
  .regex(/^[a-z0-9]+$/i, 'File extension must be alphanumeric');

/**
 * Schema for validating safe base names (for file naming).
 */
export const safeBaseNameSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Base name must contain only alphanumeric characters, underscores, and hyphens');

/**
 * Type-safe manifest parsing with validation.
 * @param data Unknown data to parse as AudioManifest
 * @returns Parsed manifest or throws ZodError
 */
export function parseManifest(data: unknown): AudioManifest {
  return manifestSchema.parse(data);
}

/**
 * Safe manifest parsing that returns a Result instead of throwing.
 * @param data Unknown data to parse as AudioManifest
 * @returns Result with parsed manifest or error
 */
export function safeParseManifest(data: unknown): { success: true; data: AudioManifest } | { success: false; error: z.ZodError } {
  return manifestSchema.safeParse(data);
}

/**
 * Creates a valid AudioManifest with sorted and unique fetchedParts.
 * @param manifest Partial manifest data
 * @returns Valid AudioManifest with normalized fetchedParts
 */
export function createValidManifest(manifest: Omit<AudioManifest, 'fetchedParts'> & { fetchedParts: number[] }): AudioManifest {
  // Sort and deduplicate fetchedParts
  const uniqueParts = Array.from(new Set(manifest.fetchedParts));
  const sortedParts = uniqueParts.sort((a, b) => a - b);
  
  const validManifest: AudioManifest = {
    ...manifest,
    fetchedParts: sortedParts,
    // Ensure mergedUntil doesn't exceed highest fetched part
    mergedUntil: Math.min(manifest.mergedUntil, sortedParts.length > 0 ? Math.max(...sortedParts) : 0),
  };
  
  // Validate the result
  return manifestSchema.parse(validManifest);
}

/**
 * Updates manifest with new fetched parts, maintaining sorted unique array.
 * @param manifest Existing manifest
 * @param newParts Array of newly fetched part indices
 * @returns Updated manifest with normalized fetchedParts
 */
export function updateManifestWithParts(manifest: AudioManifest, newParts: number[]): AudioManifest {
  const allParts = [...manifest.fetchedParts, ...newParts];
  return createValidManifest({
    ...manifest,
    fetchedParts: allParts,
    updatedAt: Date.now(),
  });
}
