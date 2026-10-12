/**
 * Drop-in helpers/controllers for your existing Node/Express card-reader backend.
 *
 * IMPORTANT:
 * - Adjust the CardReader import path to your project.
 * - Your existing POST/PUT controller should save fingerprintTemplate/fingerprintFormat.
 * - Biometric matching happens locally in ZKTecoBridge using ZKFinger SDK.
 */

const CardReader = require('../models/cardReader.model'); // <-- adjust path

const normalizeCard = (value) => String(value || '').replace(/[\s-]+/g, '').trim();

const identityFromRow = (row, { includeTemplate = false } = {}) => {
  if (!row) return null;

  const customer = row.customer || {};

  const data = {
    customerId: row.customerId || customer._id || customer.id || null,
    customerName: row.customerName || customer.name || '',
    phone: row.phone || customer.phone || '',
    documentNumber: row.documentNumber || customer.documentNumber || '',
    cardNumber: row.cardNumber || '',
    bankName: row.bankName || '',
    cardHolderName: row.cardHolderName || '',
    photoUrl: row.photoUrl || customer.avatarUrl || null,
    fingerprintUrl: row.fingerprintUrl || customer.fingerprintUrl || null,
    fingerprintFormat: row.fingerprintFormat || 'ZK10',
    balances: row.balances || [],
  };

  if (includeTemplate) {
    data.fingerprintTemplate = row.fingerprintTemplate || null;
  }

  return data;
};

// GET /api/card-reader/lookup-card?cardNumber=...
exports.lookupCard = async (req, res, next) => {
  try {
    const cardNumber = normalizeCard(req.query.cardNumber);

    if (cardNumber.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Card number is required.',
      });
    }

    // Exact comparison while tolerating spaces/dashes stored in old records.
    const candidates = await CardReader.find({
      cardNumber: { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('customer')
      .lean();

    const row = candidates.find(
      (item) => normalizeCard(item.cardNumber) === cardNumber,
    );

    if (!row) {
      return res.json({
        success: true,
        data: {
          matched: false,
          identity: null,
          balances: [],
        },
      });
    }

    return res.json({
      success: true,
      message: 'Card found.',
      data: {
        matched: true,
        identity: identityFromRow(row),
        balances: row.balances || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/card-reader/fingerprint-enrollments
// Called by trusted admin frontend, then sent to local ZKTeco bridge.
// Protect this endpoint with your existing admin/auth middleware.
exports.fingerprintEnrollments = async (req, res, next) => {
  try {
    const rows = await CardReader.find({
      fingerprintTemplate: { $exists: true, $nin: [null, ''] },
    })
      .select('+fingerprintTemplate')
      .sort({ createdAt: -1 })
      .populate('customer')
      .lean();

    // Keep latest template for each customer/card.
    const seen = new Set();
    const enrollments = [];

    for (const row of rows) {
      const key = String(
        row.customerId
        || row.customer?._id
        || normalizeCard(row.cardNumber)
        || row._id,
      );

      if (seen.has(key)) continue;
      seen.add(key);

      enrollments.push(identityFromRow(row, { includeTemplate: true }));
    }

    return res.json({
      success: true,
      data: enrollments,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Call this inside your existing CREATE controller before CardReader.create(...)
 *
 * const fingerprintTemplate =
 *   req.body.fingerprintTemplate ? String(req.body.fingerprintTemplate) : null;
 * const fingerprintFormat =
 *   req.body.fingerprintFormat ? String(req.body.fingerprintFormat) : 'ZK10';
 *
 * Then include:
 *   fingerprintTemplate,
 *   fingerprintFormat,
 *
 * Do the same in PUT/PATCH when those values are present.
 */
