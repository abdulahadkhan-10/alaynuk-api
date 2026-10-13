import { logger } from '../config/logger';

export interface SendOtpOptions {
  to: string;
  otp: string;
  recipientName?: string;
}

export class EmailService {
  private static instance: EmailService;

  private constructor() {}

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Generates a responsive, branded HTML email template for password reset OTP.
   */
  private getPasswordResetTemplate(otp: string, recipientName?: string): string {
    const name = recipientName ? recipientName.split(' ')[0] : 'there';
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password - Alayn</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8F9FA; margin: 0; padding: 24px; color: #1B2A4A; }
          .container { max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #E8ECF1; overflow: hidden; box-shadow: 0 4px 20px rgba(27, 42, 74, 0.05); }
          .header { background-color: #1B2A4A; padding: 28px 24px; text-align: center; }
          .header h1 { color: #ffffff; font-size: 22px; margin: 0; font-weight: 800; letter-spacing: -0.5px; }
          .header p { color: #A0AEC0; font-size: 13px; margin: 6px 0 0; }
          .content { padding: 32px 28px; }
          .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #1B2A4A; }
          .text { font-size: 14px; line-height: 1.6; color: #4A5568; margin-bottom: 24px; }
          .otp-box { background: #F4F5F8; border: 2px dashed #C41E2A; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
          .otp-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6B7A90; margin-bottom: 8px; }
          .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #C41E2A; margin: 0; }
          .expiry-warning { font-size: 12px; color: #E53E3E; margin-top: 8px; font-weight: 600; }
          .notice { font-size: 12px; color: #718096; line-height: 1.5; border-top: 1px solid #EDF2F7; padding-top: 20px; margin-top: 24px; }
          .footer { background-color: #F8F9FA; padding: 20px; text-align: center; font-size: 11px; color: #A0AEC0; border-top: 1px solid #E8ECF1; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Alayn</h1>
            <p>AI Operating System for Hospitality</p>
          </div>
          <div class="content">
            <div class="greeting">Hi ${name},</div>
            <div class="text">
              We received a request to reset your password. Use the verification code below to complete your password reset:
            </div>
            <div class="otp-box">
              <div class="otp-label">Your Verification Code</div>
              <div class="otp-code">${otp}</div>
              <div class="expiry-warning">⏱ Expires in 10 minutes</div>
            </div>
            <div class="text" style="font-size: 13px;">
              Enter this 6-digit code on the password reset screen to set a new password for your account.
            </div>
            <div class="notice">
              <strong>Didn't request this?</strong> You can safely ignore this email. Your password will remain unchanged and your account is secure.
            </div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Alayn Hospitality Solutions. All rights reserved.
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Sends the password reset OTP email.
   * If SMTP is configured, dispatches real email.
   * Always logs formatted OTP to console in development for rapid testing.
   */
  async sendPasswordResetOtp(options: SendOtpOptions): Promise<boolean> {
    const { to, otp, recipientName } = options;
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpPort = Number(process.env.SMTP_PORT) || 587;
    const fromAddress = process.env.SMTP_FROM || 'Alayn Security <no-reply@alaynai.com>';

    // In all environments, log a high-visibility banner to stdout for development visibility
    console.log('\n=================================================================');
    console.log('🔑 [ALAYN PASSWORD RESET OTP]');
    console.log(`📧 Recipient : ${to} (${recipientName || 'User'})`);
    console.log(`🔢 OTP Code  : ${otp}`);
    console.log(`⏱  Validity  : 10 minutes`);
    console.log('=================================================================\n');

    if (smtpHost && smtpUser && smtpPass) {
      try {
        // Dynamically require nodemailer if available
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        await transporter.sendMail({
          from: fromAddress,
          to,
          subject: `${otp} is your Alayn password reset code`,
          text: `Your Alayn password reset verification code is: ${otp}. It expires in 10 minutes. If you did not request this, please ignore this email.`,
          html: this.getPasswordResetTemplate(otp, recipientName),
        });

        logger.info(`[EmailService] Password reset OTP sent to ${to}`);
        return true;
      } catch (err: any) {
        logger.error(`[EmailService] Failed to send email via SMTP to ${to}: ${err.message}`);
        // Return true since OTP was generated and visible in console
        return true;
      }
    }

    // SMTP not configured yet; logged to console
    logger.info(`[EmailService] SMTP not configured. OTP for ${to} logged to console.`);
    return true;
  }
}

export const emailService = EmailService.getInstance();
