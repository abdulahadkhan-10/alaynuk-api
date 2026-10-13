import fs from 'fs';
import path from 'path';
import { uploadToWasabi, deleteFromWasabi } from './s3Config';

export const saveBase64Image = async (base64String: string | undefined, folderName: string): Promise<string | null> => {
  if (!base64String || !base64String.startsWith('data:image/')) {
    console.log('[saveBase64Image] Missing or invalid prefix');
    return null;
  }

  try {
    const parts = base64String.split(';base64,');
    if (parts.length !== 2) {
      console.log('[saveBase64Image] Split failed');
      return null;
    }

    const typePart = parts[0]; // e.g., 'data:image/jpeg'
    const type = typePart.replace('data:', ''); // 'image/jpeg'
    const base64Data = parts[1];
    
    let extension = type.split('/')[1] || 'png';
    if (extension === 'jpeg') extension = 'jpg';

    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`;
    const fileBuffer = Buffer.from(base64Data, 'base64');
    const s3Key = `${folderName}/${fileName}`;

    const hasWasabiConfig = 
      process.env.WASABI_ACCESS_KEY && 
      process.env.WASABI_SECRET_KEY && 
      process.env.WASABI_BUCKET_NAME;

    if (hasWasabiConfig) {
      console.log(`[saveBase64Image] Wasabi config found. Uploading ${s3Key} to Wasabi S3...`);
      const success = await uploadToWasabi(fileBuffer, s3Key, type);
      if (success) {
        console.log(`[saveBase64Image] Uploaded successfully to Wasabi: ${s3Key}`);
        return `/api/v1/media/${s3Key}`;
      }
      console.log(`[saveBase64Image] Wasabi upload failed. Falling back to local disk storage.`);
    }

    // Local fallback
    const uploadDir = path.resolve(__dirname, '../../uploads', folderName);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, fileBuffer);
    console.log('[saveBase64Image] Saved image locally to:', filePath);

    return `/api/v1/media/${s3Key}`;
  } catch (error) {
    console.error('Error saving base64 image:', error);
    return null;
  }
};

export const deleteImageFile = async (imageUrl: string | null | undefined): Promise<void> => {
  if (!imageUrl) return;

  try {
    if (imageUrl.startsWith('/api/v1/media/')) {
      const key = imageUrl.replace('/api/v1/media/', '');
      console.log(`[deleteImageFile] Deleting Wasabi S3 key: ${key}`);
      await deleteFromWasabi(key);
    } else {
      // Fallback for local files if they are absolute/relative paths on disk
      const localPath = path.resolve(__dirname, '../../uploads', imageUrl.replace('/uploads/', ''));
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        console.log(`[deleteImageFile] Deleted local file: ${localPath}`);
      }
    }
  } catch (error) {
    console.error('[deleteImageFile] Error deleting image file:', error);
  }
};
