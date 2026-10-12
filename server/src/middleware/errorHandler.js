import { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } from 'sequelize';
import { ZodError } from 'zod';

export function notFound(req, res) {
  res.status(404).json({ success: false, message: `مسیر ${req.method} ${req.originalUrl} پیدا نشد.` });
}

export function errorHandler(error, _req, res, _next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'خطای داخلی سرور رخ داد.';
  let details = error.details;

  if (error instanceof ZodError) {
    statusCode = 422;
    message = 'معلومات واردشده کامل یا معتبر نیست.';
    details = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  } else if (error instanceof UniqueConstraintError) {
    statusCode = 409;
    message = 'این مقدار قبلاً ثبت شده است.';
    details = error.errors.map((e) => ({ path: e.path, message: e.message }));
  } else if (error instanceof ForeignKeyConstraintError) {
    statusCode = 409;
    message = 'این مورد به معلومات دیگر وابسته است و قابل حذف نیست.';
  } else if (error instanceof ValidationError) {
    statusCode = 422;
    message = error.errors[0]?.message || message;
  }

  if (statusCode >= 500) console.error(error);
  res.status(statusCode).json({ success: false, message, code: error.code || 'ERROR', details });
}
