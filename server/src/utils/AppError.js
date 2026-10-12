export class AppError extends Error {
  constructor(message, statusCode = 400, code = 'REQUEST_ERROR', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
