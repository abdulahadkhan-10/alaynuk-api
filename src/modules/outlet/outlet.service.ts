import { OutletRepository } from './outlet.repository';

export class OutletService {
  private repository = new OutletRepository();

  async create(businessId: string, userId: string, data: {
    name: string;
    address: string;
    city: string;
    state: string;
    country: string;
    couponCode?: string;
    kitchenMode?: string;
  }) {
    return this.repository.createOutlet(businessId, userId, data);
  }

  async updateKitchenMode(outletId: string, kitchenMode: string, businessId?: string) {
    return this.repository.updateKitchenMode(outletId, kitchenMode, businessId);
  }

  async listForBusiness(businessId: string) {
    return this.repository.getOutletsByBusiness(businessId);
  }

  async listForUser(userId: string, businessId?: string) {
    return this.repository.getOutletsByUser(userId, businessId);
  }

  async getHolidays(outletId: string) {
    return this.repository.getHolidays(outletId);
  }

  async createHoliday(outletId: string, name: string, startDateStr: string, endDateStr: string, applyToAllOutlets?: boolean) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const promises = [];

    // Loop from start date to end date (inclusive)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      promises.push(this.repository.createHoliday(outletId, name, new Date(d), applyToAllOutlets));
    }

    const results = await Promise.all(promises);
    return results.flat(); // Flatten in case applyToAllOutlets returns arrays of arrays
  }

  async deleteHoliday(outletId: string, id: string) {
    return this.repository.deleteHoliday(outletId, id);
  }

  async updateOperatingDays(outletId: string, operatingDays: string[]) {
    return this.repository.updateOperatingDays(outletId, operatingDays);
  }

  async updateTaxRates(
    outletId: string,
    cgstRate: number,
    sgstRate: number,
    serviceTaxRate: number = 0,
    businessId?: string,
    gstRegistrationType?: 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED'
  ) {
    return this.repository.updateTaxRates(outletId, cgstRate, sgstRate, serviceTaxRate, businessId, gstRegistrationType);
  }

  async updateReceiptDetails(
    outletId: string,
    data: { phone?: string; gstin?: string; receiptTagline?: string; receiptFooter?: string; upiId?: string },
    businessId?: string
  ) {
    return this.repository.updateReceiptDetails(outletId, data, businessId);
  }

  async updateLocation(
    outletId: string,
    latitude: number,
    longitude: number,
    geofenceRadius: number,
    businessId?: string
  ) {
    return this.repository.updateLocation(outletId, latitude, longitude, geofenceRadius, businessId);
  }

  async updateAttendanceRules(
    outletId: string,
    data: { earlyBufferMinutes: number; lateGraceMinutes: number },
    businessId?: string
  ) {
    return this.repository.updateAttendanceRules(outletId, data, businessId);
  }

  async deleteUnpaidOutlet(businessId: string, outletId: string) {
    return this.repository.deleteUnpaidOutlet(businessId, outletId);
  }
}
