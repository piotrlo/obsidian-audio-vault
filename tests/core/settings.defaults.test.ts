import { describe, it, expect } from 'bun:test';
import { buildChunks } from '../../src/core/helpers';
import { DEFAULT_SETTINGS, loadTtsSettings } from '../../src/core/settings';

describe('DEFAULT_SETTINGS', () => {
  it('limits new jobs to 500 characters per chunk by default', () => {
    for (const settings of [loadTtsSettings(null), loadTtsSettings({}), { ...DEFAULT_SETTINGS, chunkSize: 0 }]) {
      expect(buildChunks('a'.repeat(1100), settings, false).map((chunk) => chunk.length)).toEqual([500, 500, 100]);
    }
  });

  it('keeps the saved chunk size on upgrade', () => {
    expect(loadTtsSettings({ chunkSize: 5000 }).chunkSize).toBe(5000);
  });

  it('contains license UI fields (undefined by default)', () => {
    expect(DEFAULT_SETTINGS).toHaveProperty('licensePlan');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseQuotaRemaining');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseQuotaLimit');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseTokenExpiresAt');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseUsagePeriod');
    expect(DEFAULT_SETTINGS.licensePlan).toBeUndefined();
  });
});

