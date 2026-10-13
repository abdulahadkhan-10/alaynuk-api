import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { OutletService } from './outlet.service';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';

export class OutletController {
  private service = new OutletService();

  create = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = req.user?.businessId;
      const userId = req.user?.id;
      if (!businessId || !userId) {
        throw new AppError('UNAUTHORIZED', 'User not associated with a business', 401);
      }
      const result = await this.service.create(businessId, userId, req.body);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = req.user?.businessId;
      const userId = req.user?.id;
      if (!businessId || !userId) {
        throw new AppError('UNAUTHORIZED', 'User not associated with a business', 401);
      }

      let result;
      if (req.user?.role === 'BUSINESS_OWNER' || req.user?.role === 'SUPER_ADMIN') {
        result = await this.service.listForBusiness(businessId);
      } else {
        result = await this.service.listForUser(userId, businessId);
      }
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getHolidays = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      if (!outletId) {
        throw new AppError('OUTLET_REQUIRED', 'Outlet context required', 400);
      }
      if (outletId === "all") {
        return sendSuccess(res, []);
      }
      const result = await this.service.getHolidays(outletId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  createHoliday = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const { name, startDate, endDate, applyToAllOutlets, date } = req.body;
      
      // Backward compatibility: If 'date' is sent, treat it as startDate
      const actualStartDate = startDate || date;
      const actualEndDate = endDate || actualStartDate;

      if (!outletId || outletId === "all" || !name || !actualStartDate) {
        throw new AppError('VALIDATION_ERROR', 'Valid Outlet ID, holiday name, and start date are required', 400);
      }
      const result = await this.service.createHoliday(outletId, name, actualStartDate, actualEndDate, applyToAllOutlets);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  deleteHoliday = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const { id } = req.params;
      if (outletId === "all") {
        throw new AppError('VALIDATION_ERROR', 'Valid Outlet ID is required', 400);
      }
      const result = await this.service.deleteHoliday(outletId, id);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateOperatingDays = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const { operatingDays } = req.body;
      if (!outletId || outletId === "all" || !Array.isArray(operatingDays)) {
        throw new AppError('VALIDATION_ERROR', 'Valid Outlet ID and operatingDays array are required', 400);
      }
      const result = await this.service.updateOperatingDays(outletId, operatingDays);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateTaxRates = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const businessId = req.user?.businessId;
      // serviceTaxRate = service CHARGE % (dine-in only, voluntary; GST applies on it)
      const { cgstRate, sgstRate, serviceTaxRate, gstRegistrationType } = req.body;
      if (!outletId) {
        throw new AppError('VALIDATION_ERROR', 'Outlet ID context is required', 400);
      }
      const parsedCgst = parseFloat(cgstRate);
      const parsedSgst = parseFloat(sgstRate);
      const parsedServiceTax = parseFloat(serviceTaxRate) || 0;
      if (
        isNaN(parsedCgst) || isNaN(parsedSgst) ||
        parsedCgst < 0 || parsedSgst < 0 || parsedServiceTax < 0 ||
        parsedCgst > 50 || parsedSgst > 50 || parsedServiceTax > 50
      ) {
        throw new AppError('VALIDATION_ERROR', 'CGST, SGST and service charge must be percentages between 0 and 50', 400);
      }
      if (gstRegistrationType !== undefined && !['REGULAR', 'COMPOSITION', 'UNREGISTERED'].includes(gstRegistrationType)) {
        throw new AppError('VALIDATION_ERROR', 'GST registration type must be REGULAR, COMPOSITION or UNREGISTERED', 400);
      }
      const result = await this.service.updateTaxRates(
        outletId,
        parsedCgst,
        parsedSgst,
        parsedServiceTax,
        businessId || undefined,
        gstRegistrationType
      );
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateReceiptDetails = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const businessId = req.user?.businessId;
      const { phone, gstin, receiptTagline, receiptFooter, upiId } = req.body;
      if (!outletId) {
        throw new AppError('VALIDATION_ERROR', 'Outlet ID context is required', 400);
      }
      const result = await this.service.updateReceiptDetails(outletId, { phone, gstin, receiptTagline, receiptFooter, upiId }, businessId || undefined);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateKitchenMode = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const businessId = req.user?.businessId;
      const { kitchenMode } = req.body;
      if (!outletId) {
        throw new AppError('VALIDATION_ERROR', 'Outlet ID context is required', 400);
      }
      if (!['KOT', 'KDS', 'HYBRID'].includes(kitchenMode)) {
        throw new AppError('VALIDATION_ERROR', 'kitchenMode must be KOT, KDS, or HYBRID', 400);
      }
      const result = await this.service.updateKitchenMode(outletId, kitchenMode, businessId || undefined);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateAttendanceRules = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const businessId = req.user?.businessId;
      const { earlyBufferMinutes, lateGraceMinutes } = req.body;
      if (!outletId) {
        throw new AppError('VALIDATION_ERROR', 'Outlet ID context is required', 400);
      }
      const result = await this.service.updateAttendanceRules(
        outletId,
        { earlyBufferMinutes, lateGraceMinutes },
        businessId || undefined
      );
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateLocation = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const outletId = (req as any).outletId;
      const businessId = req.user?.businessId;
      const { latitude, longitude, geofenceRadius } = req.body;
      
      if (!outletId) {
        throw new AppError('VALIDATION_ERROR', 'Outlet ID context is required', 400);
      }
      
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const radius = parseInt(geofenceRadius, 10);
      
      if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
        throw new AppError('VALIDATION_ERROR', 'Valid latitude, longitude, and geofenceRadius are required', 400);
      }
      
      const result = await this.service.updateLocation(outletId, lat, lng, radius, businessId || undefined);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  resolveMapLink = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { url } = req.body;
      if (!url || (!url.includes('google.com') && !url.includes('goo.gl'))) {
        throw new AppError('VALIDATION_ERROR', 'Valid Google Maps URL is required', 400);
      }
      
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      const finalUrl = response.url;
      
      let placeName = "Location from Google Maps";
      const placeMatch = finalUrl.match(/\/place\/([^\/]+)\//);
      if (placeMatch) {
        placeName = decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ');
      }
      
      const latLngMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (latLngMatch) {
         return sendSuccess(res, { lat: parseFloat(latLngMatch[1]), lng: parseFloat(latLngMatch[2]), name: placeName });
      }

      const html = await response.text();
      
      // Attempt to extract title from HTML if placeName wasn't in URL
      if (placeName === "Location from Google Maps") {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
          placeName = titleMatch[1].replace(' - Google Maps', '').trim();
        }
      }

      const metaMatch = html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/);
      if (metaMatch) {
        return sendSuccess(res, { lat: parseFloat(metaMatch[1]), lng: parseFloat(metaMatch[2]), name: placeName });
      }
      
      // another common pattern
      const lldMatch = html.match(/ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (lldMatch) {
        return sendSuccess(res, { lat: parseFloat(lldMatch[1]), lng: parseFloat(lldMatch[2]), name: placeName });
      }

      throw new AppError('VALIDATION_ERROR', 'Could not extract coordinates from the provided link', 400);
    } catch (error) {
      next(error);
    }
  };

  deleteOutlet = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = req.user?.businessId;
      const { id } = req.params;
      if (!businessId) {
        throw new AppError('UNAUTHORIZED', 'User not associated with a business', 401);
      }
      await this.service.deleteUnpaidOutlet(businessId, id);
      return sendSuccess(res, { message: 'Draft outlet deleted successfully' });
    } catch (error) {
      next(error);
    }
  };
}
export default OutletController;
