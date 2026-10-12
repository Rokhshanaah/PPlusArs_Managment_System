import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { AppError } from '../utils/AppError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsRoot = path.resolve(__dirname, '../../uploads');
export const avatarsDir = path.join(uploadsRoot, 'avatars');
export const cardReaderDir = path.join(uploadsRoot, 'card-reader');

fs.mkdirSync(avatarsDir, { recursive: true });
fs.mkdirSync(cardReaderDir, { recursive: true });

function makeImageStorage(dir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      const userId = req.params?.id || req.user?.id || 'u';
      const kind = String(file.fieldname || 'file').replace(/[^a-z0-9_-]/gi, '') || 'file';
      cb(null, `${userId}-${kind}-${Date.now()}${safeExt}`);
    },
  });
}

function imageFilter(_req, file, cb) {
  if (!String(file.mimetype || '').startsWith('image/')) {
    return cb(new AppError('فقط فایل تصویری مجاز است.', 400, 'INVALID_FILE'));
  }
  return cb(null, true);
}

export const avatarUpload = multer({
  storage: makeImageStorage(avatarsDir),
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
});

export const cardReaderUpload = multer({
  storage: makeImageStorage(cardReaderDir),
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
});

export function publicAvatarUrl(filename) {
  if (!filename) return null;
  return `/uploads/avatars/${path.basename(filename)}`;
}

export function publicCardReaderUrl(filename) {
  if (!filename) return null;
  return `/uploads/card-reader/${path.basename(filename)}`;
}
