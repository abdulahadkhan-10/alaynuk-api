import express from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../utils/s3Config';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import { Readable } from 'stream';

const router = express.Router();

router.get(/(.*)/, async (req, res) => {
  const key = req.params[0].replace(/^\/+/, '');

  if (!key || key === 'test') {
    return res.send('Media proxy active');
  }

  try {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.WASABI_BUCKET_NAME,
        Key: key,
      });

      const response = await s3Client.send(command);

      // Determine content type
      const contentType = response.ContentType || mime.lookup(key) || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

      if (response.Body && response.Body instanceof Readable) {
        return response.Body.pipe(res);
      } else if (response.Body) {
        // Handle other S3 Body types
        return (response.Body as any).pipe(res);
      }
      return res.status(404).send('File body is empty');
    } catch (s3Err) {
      // Fallback to local files
      const actualKey = key.startsWith('uploads/') ? key.replace('uploads/', '') : key;
      const localPath = path.resolve(__dirname, '../../uploads', actualKey);

      if (fs.existsSync(localPath)) {
        const contentType = mime.lookup(localPath) || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        return res.sendFile(localPath);
      }

      return res.status(404).send('File not found');
    }
  } catch (err) {
    console.error('Media Proxy Error:', err);
    res.status(500).send('Error fetching media');
  }
});

export default router;
