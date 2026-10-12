import { Op } from 'sequelize';

export function pageInfo(query) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginationResult({ rows, count }, page, limit) {
  return { rows, pagination: { page, limit, total: count, pages: Math.ceil(count / limit) } };
}

export function searchWhere(search, fields) {
  const value = String(search || '').trim();
  if (!value) return {};
  return { [Op.or]: fields.map((field) => ({ [field]: { [Op.like]: `%${value}%` } })) };
}

export function emitChange(req, event, data = {}) {
  req.app.get('io')?.emit(event, { ...data, at: new Date().toISOString() });
}
