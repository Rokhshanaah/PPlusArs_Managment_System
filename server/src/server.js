import http from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { app } from './app.js';
import { env } from './config/env.js';
import { initializeDatabase } from './db/init.js';
import { User } from './models/index.js';
import { startWhatsappWorker } from './services/whatsapp.js';
import { startTelegramBackupWorker } from './services/telegramBackup.js';

await initializeDatabase();
const server=http.createServer(app);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const allowed = new Set(
    env.clientUrl
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );
  if (allowed.has('*') || allowed.has(origin)) return true;
  // Allow same LAN/device access when opening via PC IP on phone
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

const io=new Server(server,{
  cors:{
    origin:(origin,cb)=>cb(null, isAllowedOrigin(origin)),
    methods:['GET','POST'],
  },
});
io.use(async(socket,next)=>{try{const token=socket.handshake.auth?.token;if(!token)return next(new Error('unauthorized'));const payload=jwt.verify(token,env.jwtSecret);const user=await User.findByPk(payload.sub);if(!user||!user.isActive)return next(new Error('unauthorized'));socket.user=user;next();}catch{return next(new Error('unauthorized'));}});
io.on('connection',(socket)=>{socket.emit('system:connected',{message:'PPlus.Arz آنلاین است',at:new Date().toISOString()});});
app.set('io',io);
startWhatsappWorker({ intervalMs: 15000 });
startTelegramBackupWorker();
const host = process.env.HOST || '0.0.0.0';
server.listen(env.port, host, () => {
  console.log(`PPlus.Arz API running on http://localhost:${env.port}`);
  console.log(`LAN access: http://<PC-IP>:${env.port}`);
});
