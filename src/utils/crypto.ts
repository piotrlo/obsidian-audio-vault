export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Crypto utilities for the AudioVault plugin
 */

/**
 * Hash a license key using SHA-256
 * @param licenseKey The plain text license key
 * @returns The hexadecimal hash of the license key
 */
export async function hashLicenseKey(licenseKey: string): Promise<string> {
  if (!licenseKey || typeof licenseKey !== 'string') {
    throw new Error('Invalid license key');
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(licenseKey.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}
