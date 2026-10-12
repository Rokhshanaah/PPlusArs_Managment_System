import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { uploadsRoot } from './middleware/upload.js';
import authRoutes from './routes/auth.js';
import masterRoutes from './routes/master-data.js';
import accountingRoutes from './routes/accounting.js';
import insightRoutes from './routes/insights.js';
import marketRoutes from './routes/market.js';
import messagesRoutes from './routes/messages.js';
import cardReaderRoutes from './routes/card-reader.js';
import expenseRoutes from './routes/expenses.js';
import { whatsappAdminRouter, whatsappWebhookRouter } from './routes/whatsapp.js';
import publicRoutes from './routes/public.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveFrontendDist() {
  const candidates = [
    process.env.FRONTEND_DIST,
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(__dirname, '../frontend/dist'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const absolute = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(process.cwd(), candidate);
    if (fs.existsSync(path.join(absolute, 'index.html'))) return absolute;
  }
  return null;
}

const frontendDist = resolveFrontendDist();

export const app=express();
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use(helmet({
  crossOriginResourcePolicy:{policy:'cross-origin'},
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: (origin, callback) => {
    if (env.nodeEnv === 'development') return callback(null, true);
    if (!origin) return callback(null, true);
    const allowed = env.clientUrl.split(',').map((v) => v.trim()).filter(Boolean);
    if (allowed.includes('*') || allowed.includes(origin)) return callback(null, true);
    try {
      const { hostname } = new URL(origin);
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
      ) {
        return callback(null, true);
      }
    } catch {
      /* ignore */
    }
    return callback(null, false);
  },
  credentials: false,
}));
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true,limit:'2mb'}));
app.use('/uploads', express.static(uploadsRoot));
app.use(morgan(env.nodeEnv==='production'?'combined':'dev'));
app.get('/api/health',(_req,res)=>res.json({success:true,data:{status:'ok',time:new Date().toISOString()}}));
app.use('/api',whatsappWebhookRouter);
app.use('/api', publicRoutes);
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:100,standardHeaders:true,legacyHeaders:false}),authRoutes);
app.use('/api',requireAuth,masterRoutes,accountingRoutes,insightRoutes,marketRoutes,messagesRoutes,cardReaderRoutes,expenseRoutes,whatsappAdminRouter);

if (frontendDist) {
  app.use(express.static(frontendDist, { index: false, maxAge: env.nodeEnv === 'production' ? '1h' : 0 }));
  app.get(/^(?!\/api(?:\/|$)|\/uploads(?:\/|$)|\/socket\.io(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);
