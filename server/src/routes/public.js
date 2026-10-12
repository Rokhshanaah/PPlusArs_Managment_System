import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { validate } from '../middleware/validate.js';
import {
  Customer,
  CustomerMessage,
  Currency,
  ExchangeRate,
  Remittance,
  SystemSetting,
} from '../models/index.js';
import { buildCustomerLedgerStatement } from '../services/accounting.js';
import { emitChange } from './common.js';
import {
  parseCustomerPortalLanguage,
  parseCustomerPortalMenus,
} from '../utils/customerPortal.js';
import { loadAppPlan, planToPublicFields } from '../utils/appPlans.js';

const router = Router();

const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const messageBody = z.object({
  body: z.object({
    body: z.string().trim().min(2).max(2000),
  }),
  params: z.object({
    token: z.string().trim().min(16),
  }),
  query: z.record(z.string(), z.any()).optional().default({}),
});

async function resolvePortalCustomer(tokenRaw) {
  const token = String(tokenRaw || '').trim().toLowerCase();
  if (!token || token.length < 16) throw new AppError('لینک معتبر نیست.', 404);
  const customer = await Customer.findOne({ where: { viewToken: token } });
  if (!customer) throw new AppError('لینک معتبر نیست یا منقضی شده است.', 404);
  if (String(customer.state || '').includes('غیر')) {
    throw new AppError('این حساب غیرفعال است.', 403);
  }
  return customer;
}

router.get('/public/company', portalLimiter, asyncHandler(async (_req, res) => {
  const [rows, plan] = await Promise.all([
    SystemSetting.findAll({
      where: {
        settingKey: [
          'company_name',
          'company_slogan',
          'company_phone',
          'company_email',
          'company_whatsapp',
          'company_address',
        ],
      },
    }),
    loadAppPlan(),
  ]);
  const data = Object.fromEntries(rows.map((row) => [row.settingKey, row.settingValue]));
  Object.assign(data, planToPublicFields(plan));
  res.json({ success: true, data });
}));

router.get('/public/customers/:token', portalLimiter, asyncHandler(async (req, res) => {
  const plan = await loadAppPlan();
  if (!plan.features.customerPortal) {
    throw new AppError('لینک حساب مشتری فعال نیست.', 403);
  }
  const customer = await resolvePortalCustomer(req.params.token);

  const [statement, settingsRows, messages] = await Promise.all([
    buildCustomerLedgerStatement(customer.id),
    SystemSetting.findAll({
      where: {
        settingKey: [
          'company_name',
          'company_slogan',
          'company_phone',
          'customer_portal_language',
          'customer_portal_menus',
        ],
      },
    }),
    CustomerMessage.findAll({
      where: { customerId: customer.id },
      order: [['id','DESC']],
      limit: 30,
    }),
  ]);

  const settings = {};
  for (const row of settingsRows) settings[row.settingKey] = row.settingValue;
  const menus = parseCustomerPortalMenus(settings.customer_portal_menus);
  const language = parseCustomerPortalLanguage(settings.customer_portal_language);
  const needRates = menus.some((k) => ['rates', 'buy', 'sell', 'exchange'].includes(k));
  const needRemittances = menus.includes('remittances');
  const needCurrencies = menus.includes('currencies');

  const [ratesRows, remittanceRows, currencyRows] = await Promise.all([
    needRates
      ? ExchangeRate.findAll({
        include: ['fromCurrency', 'toCurrency'],
        order: [['id', 'DESC']],
        limit: 80,
      })
      : [],
    needRemittances
      ? Remittance.findAll({
        where: { senderId: customer.id },
        include: ['currency'],
        order: [['id', 'DESC']],
        limit: 40,
      })
      : [],
    needCurrencies
      ? Currency.findAll({
        where: { isActive: true },
        order: [['isBase', 'DESC'], ['code', 'ASC']],
      })
      : [],
  ]);

  res.json({
    success: true,
    data: {
      portal: { language, menus },
      company: {
        name: settings.company_name || 'PPlus.Arz',
        slogan: settings.company_slogan || '',
        phone: settings.company_phone || '',
      },
      customer: {
        name: customer.name,
        phone: customer.phone,
        fatherName: customer.fatherName || '',
        address: customer.address || '',
      },
      balances: statement.balances.map((b) => ({
        amount: b.amount,
        currency: b.currency
          ? {
            code: b.currency.code,
            name: b.currency.name,
            symbol: b.currency.symbol,
          }
          : null,
      })),
      entries: statement.entries.map((e) => ({
        id: e.id,
        number: e.number,
        type: e.type,
        typeKey: e.typeKey,
        amount: e.amount,
        credit: e.credit,
        debit: e.debit,
        runningBalance: e.runningBalance,
        runningSide: e.runningSide,
        note: e.note,
        isOpening: e.isOpening,
        openingSide: e.openingSide,
        createdAt: e.createdAt,
        currency: e.currency
          ? { code: e.currency.code, symbol: e.currency.symbol, name: e.currency.name }
          : null,
      })),
      currencyGroups: statement.currencyGroups.map((g) => ({
        currencyId: g.currencyId,
        currentBalance: g.currentBalance,
        currentSide: g.currentSide,
        openingBalance: g.openingBalance,
        openingSide: g.openingSide,
        entryCount: g.entryCount,
        currency: g.currency
          ? { code: g.currency.code, symbol: g.currency.symbol, name: g.currency.name }
          : null,
        entries: g.entries.map((e) => ({
          id: e.id,
          number: e.number,
          type: e.type,
          typeKey: e.typeKey,
          credit: e.credit,
          debit: e.debit,
          runningBalance: e.runningBalance,
          runningSide: e.runningSide,
          note: e.note,
          isOpening: e.isOpening,
          createdAt: e.createdAt,
        })),
      })),
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        sender: m.sender,
        createdAt: m.createdAt,
        readAt: m.readAt,
      })),
      rates: ratesRows.map((r) => ({
        id: r.id,
        buyRate: r.buyRate,
        sellRate: r.sellRate,
        from: r.fromCurrency ? { code: r.fromCurrency.code, name: r.fromCurrency.name } : null,
        to: r.toCurrency ? { code: r.toCurrency.code, name: r.toCurrency.name } : null,
      })),
      remittances: remittanceRows.map((r) => ({
        id: r.id,
        number: r.number,
        amount: r.amount,
        state: r.state,
        receiverName: r.receiverName,
        createdAt: r.createdAt,
        currency: r.currency ? { code: r.currency.code, symbol: r.currency.symbol } : null,
      })),
      currencies: currencyRows.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        isBase: c.isBase,
      })),
    },
  });
}));

router.post(
  '/public/customers/:token/messages',
  messageLimiter,
  validate(messageBody),
  asyncHandler(async (req, res) => {
    const plan = await loadAppPlan();
    if (!plan.features.customerPortal) {
      throw new AppError('لینک حساب مشتری فعال نیست.', 403);
    }
    const customer = await resolvePortalCustomer(req.validated.params.token);
    const text = String(req.validated.body.body || '').trim();
    if (text.length < 2) throw new AppError('متن پیام کوتاه است.', 400);

    const row = await CustomerMessage.create({
      customerId: customer.id,
      body: text,
      sender: 'customer',
    });

    emitChange(req, 'messages:changed', {
      id: row.id,
      customerId: customer.id,
      customerName: customer.name,
      unread: true,
    });

    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        body: row.body,
        sender: row.sender,
        createdAt: row.createdAt,
        readAt: row.readAt,
      },
    });
  }),
);

export default router;
