import type { PasswordBlocklist } from './password-policy.js';

const blockedPasswords = new Set([
  '123456789012345',
  'letmeinletmeinletmein',
  'passwordpassword',
  'qwertyqwertyqwerty',
  'welcome123456789',
  'zambia123456789',
]);

export const commonPasswordBlocklist: PasswordBlocklist = Object.freeze({
  async contains(password: string): Promise<boolean> {
    return blockedPasswords.has(password.toLowerCase());
  },
});
