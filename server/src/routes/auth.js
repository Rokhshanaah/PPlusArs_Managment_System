import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from '../utils/audit.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const loginSchema = z.object({ body: z.object({ username: z.string().trim().min(1), password: z.string().min(1) }), params: z.object({}), query: z.object({}) });

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { username, password } = req.validated.body;
  const user = await User.unscoped().findOne({ where: { username }, include: ['branch'] });
  const normalizedHash = user?.password?.startsWith('$2y$') ? `$2b$${user.password.slice(4)}` : user?.password;
  const ok = user && normalizedHash && await bcrypt.compare(password, normalizedHash);
  if (!ok) {
    await writeAudit({ req, user: { name: username }, action: 'تلاش ناکام برای ورود' });
    throw new AppError('نام ورود یا رمز درست نیست.', 401, 'INVALID_CREDENTIALS');
  }
  if (!user.isActive) throw new AppError('حساب شما غیرفعال است.', 403, 'ACCOUNT_DISABLED');
  await user.update({ lastSeenAt: new Date() });
  await writeAudit({ req, user, action: 'وارد سامانه شد' });
  const token = jwt.sign({ sub: String(user.id), username: user.username }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  const safeUser = await User.findByPk(user.id, { include: ['branch'] });
  res.json({ success: true, data: { token, user: safeUser } });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await writeAudit({ req, user: req.user, action: 'از سامانه بیرون شد' });
  res.json({ success: true, message: 'با موفقیت خارج شدید.' });
}));

export default router;
