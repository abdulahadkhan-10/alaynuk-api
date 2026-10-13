import crypto from 'crypto';
import { AppError } from '../../utils/AppError';

export interface CreateOrderParams {
  orderId: string;
  orderAmount: number; // in Rupees with 2 decimals e.g. 1999.00 or derived from paise
  orderCurrency?: string;
  customerDetails: {
    customerId: string;
    customerEmail?: string;
    customerPhone?: string;
    customerName?: string;
  };
  orderMeta?: {
    returnUrl?: string;
    notifyUrl?: string;
    paymentMethods?: string;
  };
  orderNotes?: Record<string, string>;
}

export interface CashfreeOrderResponse {
  cf_order_id: string;
  order_id: string;
  entity: string;
  order_currency: string;
  order_amount: number;
  order_status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED';
  payment_session_id: string;
  order_token?: string;
  customer_details: any;
  order_meta?: any;
  order_notes?: Record<string, string>;
  payments?: any;
  settlements?: any;
  refunds?: any;
}

export class CashfreeService {
  private appId: string;
  private secretKey: string;
  private apiVersion: string;
  private baseUrl: string;

  constructor() {
    this.appId = process.env.CASHFREE_APP_ID || '';
    this.secretKey = process.env.CASHFREE_SECRET_KEY || '';
    this.apiVersion = process.env.CASHFREE_API_VERSION || '2023-08-01';
    
    const env = (process.env.CASHFREE_ENV || 'SANDBOX').toUpperCase();
    this.baseUrl = env === 'PRODUCTION'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-client-id': this.appId,
      'x-client-secret': this.secretKey,
      'x-api-version': this.apiVersion,
      'Accept': 'application/json'
    };
  }

  /**
   * Create a Cashfree Payment Order
   */
  async createOrder(params: CreateOrderParams): Promise<CashfreeOrderResponse> {
    if (!this.appId || !this.secretKey || this.appId.startsWith('TEST_APP_ID')) {
      console.warn('[CashfreeService] Using mock payment session (Sandbox credentials pending).');
      return {
        cf_order_id: `cf_mock_${Date.now()}`,
        order_id: params.orderId,
        entity: 'order',
        order_currency: params.orderCurrency || 'INR',
        order_amount: params.orderAmount,
        order_status: 'ACTIVE',
        payment_session_id: `session_mock_${Date.now()}_${params.orderId}`,
        customer_details: params.customerDetails,
        order_notes: params.orderNotes
      };
    }

    try {
      const payload = {
        order_id: params.orderId,
        order_amount: params.orderAmount,
        order_currency: params.orderCurrency || 'INR',
        customer_details: {
          customer_id: params.customerDetails.customerId,
          customer_email: params.customerDetails.customerEmail || 'owner@alayn.app',
          customer_phone: params.customerDetails.customerPhone || '9999999999',
          customer_name: params.customerDetails.customerName || 'Business Owner',
        },
        order_meta: {
          return_url: params.orderMeta?.returnUrl,
          notify_url: params.orderMeta?.notifyUrl,
          payment_methods: params.orderMeta?.paymentMethods
        },
        order_notes: params.orderNotes || {}
      };

      const response = await fetch(`${this.baseUrl}/orders`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });

      const responseData: any = await response.json();

      if (!response.ok) {
        console.error('[CashfreeService] Create Order Error:', responseData);
        throw new AppError(
          'PAYMENT_GATEWAY_ERROR',
          responseData?.message || 'Failed to create payment order with Cashfree',
          response.status || 500
        );
      }

      return responseData as CashfreeOrderResponse;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      console.error('[CashfreeService] Error creating Cashfree order:', error);
      throw new AppError('PAYMENT_GATEWAY_ERROR', error.message || 'Cashfree communication error', 500);
    }
  }

  /**
   * Fetch Order details by order_id
   */
  async getOrder(orderId: string): Promise<CashfreeOrderResponse> {
    if (!this.appId || !this.secretKey || this.appId.startsWith('TEST_APP_ID')) {
      return {
        cf_order_id: `cf_mock_${orderId}`,
        order_id: orderId,
        entity: 'order',
        order_currency: 'INR',
        order_amount: 1999.00,
        order_status: 'PAID',
        payment_session_id: `session_mock_${orderId}`,
        customer_details: { customer_id: 'mock_cust' },
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      const data: any = await response.json();
      if (!response.ok) {
        throw new AppError('PAYMENT_GATEWAY_ERROR', data?.message || 'Order not found in Cashfree', response.status || 404);
      }
      return data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      throw new AppError('PAYMENT_GATEWAY_ERROR', error.message || 'Error fetching Cashfree order', 500);
    }
  }

  /**
   * Fetch payments for a specific order
   */
  async getOrderPayments(orderId: string): Promise<any[]> {
    if (!this.appId || !this.secretKey || this.appId.startsWith('TEST_APP_ID')) {
      return [{
        payment_status: 'SUCCESS',
        payment_method: 'UPI',
        payment_currency: 'INR',
        payment_amount: 1999.00,
        cf_payment_id: `cf_pay_${Date.now()}`
      }];
    }

    try {
      const response = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(orderId)}/payments`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      const data: any = await response.json();
      if (!response.ok) {
        return [];
      }
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[CashfreeService] Error fetching order payments:', error);
      return [];
    }
  }

  /**
   * Verify Cashfree Webhook Signature
   * Signature calculation: Base64(HMAC-SHA256(timestamp + rawBody, secretKey))
   */
  verifyWebhookSignature(rawBody: string, timestamp: string, signature: string): boolean {
    const isProduction = process.env.NODE_ENV === 'production';
    if (!this.secretKey || this.secretKey.startsWith('TEST_SECRET_KEY')) {
      if (isProduction) {
        console.error('[CashfreeService] CRITICAL: Invalid or missing Cashfree Secret Key in production.');
        return false;
      }
      return process.env.NODE_ENV === 'test';
    }

    try {
      const payloadToSign = timestamp + rawBody;
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(payloadToSign)
        .digest('base64');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
    } catch (error) {
      console.error('[CashfreeService] Webhook signature verification failed:', error);
      return false;
    }
  }
}
export default CashfreeService;
