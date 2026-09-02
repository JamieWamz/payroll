import { DomainError } from '../../../shared/domain/domain-error.js';

declare const permissionIdentifierBrand: unique symbol;

export type PermissionIdentifier = string & {
  readonly [permissionIdentifierBrand]: 'PermissionIdentifier';
};

const permissionIdentifierMaximumLength = 128;
const permissionIdentifierPattern =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;

export function normalizePermissionIdentifier(
  value: string,
): PermissionIdentifier {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-');

  if (
    normalized.length > permissionIdentifierMaximumLength ||
    !permissionIdentifierPattern.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_PERMISSION_IDENTIFIER',
      'Permission identifier must be a dot-separated lower-case namespace',
      { maximumLength: permissionIdentifierMaximumLength },
    );
  }

  return normalized as PermissionIdentifier;
}

export function normalizePermissionIdentifiers(
  values: readonly string[],
): readonly PermissionIdentifier[] {
  const identifiers = [...new Set(values.map(normalizePermissionIdentifier))];
  identifiers.sort();
  return Object.freeze(identifiers);
}
