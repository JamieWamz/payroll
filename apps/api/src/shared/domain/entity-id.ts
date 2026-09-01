import { DomainError } from './domain-error.js';

declare const entityIdBrand: unique symbol;

export type EntityId<EntityName extends string> = string & {
  readonly [entityIdBrand]: EntityName;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseEntityId<EntityName extends string>(
  value: string,
  entityName: EntityName,
): EntityId<EntityName> {
  if (value !== value.trim() || !uuidPattern.test(value)) {
    throw new DomainError(
      'INVALID_ENTITY_ID',
      `${entityName} identifier must be a canonical UUID`,
      { entity: entityName },
    );
  }

  return value.toLowerCase() as EntityId<EntityName>;
}
