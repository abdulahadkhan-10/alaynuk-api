import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

console.log('--- Checking SMTP Configuration ---');
console.log({
  host: SMTP_HOST,
  port: SMTP_PORT,
  user: SMTP_USER,
  hasPass: Boolean(SMTP_PASS),
});

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT) || 587,
  secure: Number(SMTP_PORT) === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  connectionTimeout: 8000,
});

async function verify() {
  try {
    console.log('Connecting to SMTP server...');
    const verified = await transporter.verify();
    console.log('SMTP Connection Success:', verified);
  } catch (err: any) {
    console.error('SMTP Connection Failed:');
    console.error('Code:', err.code);
    console.error('Message:', err.message);
    console.error('Response:', err.response);
  }
}

verify();
