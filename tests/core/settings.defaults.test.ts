import { describe, it, expect } from 'bun:test';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

describe('DEFAULT_SETTINGS', () => {
  it('contains license UI fields (undefined by default)', () => {
    expect(DEFAULT_SETTINGS).toHaveProperty('licensePlan');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseQuotaRemaining');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseQuotaLimit');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseTokenExpiresAt');
    expect(DEFAULT_SETTINGS).toHaveProperty('licenseUsagePeriod');
    expect(DEFAULT_SETTINGS.licensePlan).toBeUndefined();
  });
});


