/**
 * Bill calculation — the single source of truth for every amount on a restaurant bill.
 *
 * Professional model (standard for Indian restaurant POS): each round sent to the kitchen is a KOT
 * with no money on it; the bill is always calculated from ALL items on the order with this function,
 * recalculated whenever the bill changes, and frozen at settlement. Never add amounts round by round.
 *
 *   subtotal       = Σ unit price × qty
 *   net            = subtotal − discount
 *   service charge = net × rate         (dine-in only; voluntary — the customer may ask to remove it)
 *   taxable value  = net + service charge   (GST applies on service charge: part of value of supply, CGST Act s.15)
 *   CGST / SGST    = taxable × rate         (none for Composition / Unregistered businesses)
 *   total          = rounded to the nearest rupee, with a round-off line
 *
 * The frontend POS preview mirrors this in alayn-frontend/src/lib/billing.ts — keep them in sync.
 */

export type GstRegistrationType = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';

export interface BillRates {
  /** Percentages, e.g. 2.5 for 2.5% */
  cgstRate: number;
  sgstRate: number;
  serviceChargeRate: number;
}

export interface BillOptions {
  /** Service charge only applies to dine-in (table) orders */
  dineIn: boolean;
  serviceChargeWaived?: boolean;
  discountPaise?: number;
  gstRegistrationType?: GstRegistrationType;
}

export interface BillLine {
  unitPricePaise: number;
  quantity: number;
}

export interface BillTotals {
  subtotalPaise: number;
  discountPaise: number;
  serviceChargePaise: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  /** Rates actually applied (0 where not applicable) — saved on the order so receipts never drift */
  appliedRates: BillRates;
}

export const DINE_IN_SOURCES = ['TABLE', 'QR'];

export function isDineIn(source?: string | null): boolean {
  return !!source && DINE_IN_SOURCES.includes(source);
}

export function calculateBill(items: BillLine[], rates: BillRates, options: BillOptions): BillTotals {
  const subtotalPaise = items.reduce((sum, item) => sum + item.unitPricePaise * item.quantity, 0);
  const discountPaise = Math.min(Math.max(0, Math.round(options.discountPaise || 0)), subtotalPaise);
  const netPaise = subtotalPaise - discountPaise;

  const serviceChargeRate =
    options.dineIn && !options.serviceChargeWaived ? Math.max(0, rates.serviceChargeRate || 0) : 0;
  const serviceChargePaise = Math.round((netPaise * serviceChargeRate) / 100);

  const collectsGst = (options.gstRegistrationType || 'REGULAR') === 'REGULAR';
  const cgstRate = collectsGst ? Math.max(0, rates.cgstRate || 0) : 0;
  const sgstRate = collectsGst ? Math.max(0, rates.sgstRate || 0) : 0;

  const taxableValuePaise = netPaise + serviceChargePaise;
  const cgstPaise = Math.round((taxableValuePaise * cgstRate) / 100);
  const sgstPaise = Math.round((taxableValuePaise * sgstRate) / 100);

  const grossPaise = taxableValuePaise + cgstPaise + sgstPaise;
  const totalPaise = Math.round(grossPaise / 100) * 100;

  return {
    subtotalPaise,
    discountPaise,
    serviceChargePaise,
    taxableValuePaise,
    cgstPaise,
    sgstPaise,
    roundOffPaise: totalPaise - grossPaise,
    totalPaise,
    appliedRates: { cgstRate, sgstRate, serviceChargeRate },
  };
}
