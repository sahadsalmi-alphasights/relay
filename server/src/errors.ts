export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function badRequest(message = "bad request"): HttpError {
  return new HttpError(400, message);
}

export function forbidden(message = "forbidden"): HttpError {
  return new HttpError(403, message);
}

export function notFound(message = "not found"): HttpError {
  return new HttpError(404, message);
}

export function conflict(message = "conflict"): HttpError {
  return new HttpError(409, message);
}
