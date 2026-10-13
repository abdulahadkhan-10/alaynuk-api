import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const region = process.env.WASABI_REGION || 'ap-southeast-1';

export const s3Client = new S3Client({
  region,
  endpoint: `https://s3.${region}.wasabisys.com`,
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY || '',
    secretAccessKey: process.env.WASABI_SECRET_KEY || '',
  },
  forcePathStyle: true, // Required for Wasabi
});

export const uploadToWasabi = async (
  fileBuffer: Buffer,
  key: string,
  contentType: string
): Promise<boolean> => {
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.WASABI_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error uploading to Wasabi S3:', error);
    return false;
  }
};

export const deleteFromWasabi = async (key: string): Promise<boolean> => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.WASABI_BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error('Error deleting from Wasabi S3:', error);
    return false;
  }
};
