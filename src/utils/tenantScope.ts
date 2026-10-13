// Multi-tenant scoping helpers.
//
// Every lookup BY ID must also prove the record belongs to the caller: either the selected outlet,
// or — in "all outlets" mode — one of the caller's own business's outlets. Never search all businesses.

// A valid UUID that matches no row; used when a caller has no business (safer than dropping the filter)
export const NO_MATCH_UUID = '00000000-0000-0000-0000-000000000000';

export function isAllOutlets(outletId?: string | null): boolean {
  return !outletId || outletId === 'all';
}

/**
 * Filter for menu items, which can be shared across outlets (MenuItemOutlet) as well as owned by one
 * outlet. Wrapped in AND so it can be spread into a `where` without clobbering another OR.
 */
export function menuItemScope(outletId?: string | null, businessId?: string | null): Record<string, unknown> {
  if (!isAllOutlets(outletId)) {
    return { AND: [{ OR: [{ outletId }, { outlets: { some: { outletId } } }] }] };
  }
  const business = businessId || NO_MATCH_UUID;
  return {
    AND: [{ OR: [{ outlet: { businessId: business } }, { outlets: { some: { outlet: { businessId: business } } } }] }],
  };
}

/** Filter for models that have an `outletId` column and an `outlet` relation. */
export function outletScope(outletId?: string | null, businessId?: string | null): Record<string, unknown> {
  if (!isAllOutlets(outletId)) return { outletId };
  return { outlet: { businessId: businessId || NO_MATCH_UUID } };
}
