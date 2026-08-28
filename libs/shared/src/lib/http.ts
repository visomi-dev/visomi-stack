import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';

export const errorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const responseEnvelopeSchema = z.object({
  status: z.number().optional(),
  message: z.string(),
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

function createEnvelope(message: string, data: unknown, meta?: Record<string, unknown>): ResponseEnvelope {
  return { message, data, meta };
}

const httpResponse = {
  json(
    res: Response,
    {
      data,
      status,
      meta,
      message,
    }: { data: unknown; status?: number; meta?: Record<string, unknown>; message: string },
  ) {
    return status !== undefined
      ? res.status(status).send(createEnvelope(message, data, meta))
      : res.send(createEnvelope(message, data, meta));
  },
};

class HttpError extends Error {
  data: unknown;
  code: string;
  statusCode: number;

  constructor({
    data,
    code,
    message,
    statusCode,
  }: {
    data?: unknown;
    code: string;
    message: string;
    statusCode: number;
  }) {
    super(message);

    this.data = data;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error('[ error ] API request failed', redactedErrorDetails(error));

  if (error instanceof HttpError) {
    res.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      data: error.data,
    });

    return;
  }

  if (isRequestError(error)) {
    res.status(error.status).send({
      code: 'invalid_request',
      message: 'The request payload is invalid.',
    });

    return;
  }

  res.status(500).send({
    code: 'internal_server_error',
    message: 'The request could not be completed.',
  });
}

function redactedErrorDetails(error: unknown): { code: string; statusCode?: number } {
  if (error instanceof HttpError) return { code: error.code, statusCode: error.statusCode };
  if (isRequestError(error)) return { code: 'invalid_request', statusCode: error.status };

  return { code: 'internal_server_error', statusCode: 500 };
}

function isRequestError(error: unknown): error is { status: number } {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;

  const status = (error as { status?: unknown }).status;

  return typeof status === 'number' && status >= 400 && status < 500;
}

export { HttpError, createEnvelope, httpResponse, redactedErrorDetails };
