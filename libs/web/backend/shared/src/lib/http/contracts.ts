import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { createDocument, type ZodOpenApiOperationObject } from 'zod-openapi';

import { AuthHttpError } from './auth-http-error';
import { HttpError } from './http-error';

export type RequestSchemas = {
  body?: z.ZodType;
  params?: z.ZodType<unknown, Record<string, unknown>>;
  query?: z.ZodType<unknown, Record<string, unknown>>;
  headers?: z.ZodType<unknown, Record<string, unknown>>;
};

export type RequestSchema = z.ZodObject<Record<string, z.ZodType>> & { shape: RequestSchemas };

export type RouteContract<S extends RequestSchema = RequestSchema> = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  description?: string;
  request: S;
  responses: NonNullable<ZodOpenApiOperationObject['responses']>;
  security: NonNullable<ZodOpenApiOperationObject['security']>;
  validationErrors?: ValidationErrors;
};

export type ValidationErrors = Readonly<Record<string, { status: 400 | 401 | 403 | 422; code: string }>>;

export function defineRoute<const C extends RouteContract>(contract: C): C {
  return contract;
}

function parse<S extends z.ZodType>(schema: S, value: unknown, errors: ValidationErrors): z.output<S> {
  const result = z.safeParse(schema, value);

  if (result.success) {
    return result.data;
  }

  // Only explicit public codes can cross the boundary. No issue paths, values,
  // schema messages or raw Zod errors are returned or passed to telemetry.
  const code = result.error.issues.some((issue) => issue.code === 'unrecognized_keys')
    ? 'request_invalid'
    : result.error.issues[0].message;

  const approved = Object.prototype.hasOwnProperty.call(errors, code) ? errors[code] : undefined;

  if (approved?.status === 401 || approved?.status === 403) {
    throw new AuthHttpError(approved.status, approved.code);
  }

  if (approved) {
    throw new HttpError(approved.status, approved.code);
  }

  throw new HttpError(400, 'request_invalid');
}

export function validateRequest<S extends RequestSchema>(
  schemas: S,
  handler: (request: Request, response: Response, input: z.output<S>) => unknown,
  errors: ValidationErrors = {},
): RequestHandler {
  return function validatedRequest(request, response, next) {
    try {
      const input = parse(
        schemas,
        {
          body: request.body,
          params: request.params,
          query: request.query,
          headers: request.headers,
        },
        errors,
      );

      return handler(request, response, input);
    } catch (error) {
      next(error);
    }
  };
}

export function registerRoute<S extends RequestSchema>(
  router: Router,
  contract: RouteContract<S>,
  handler: (request: Request, response: Response, input: z.output<S>) => unknown,
  ...beforeValidation: RequestHandler[]
): void {
  router[contract.method](
    contract.path,
    ...beforeValidation,
    validateRequest(contract.request, handler, contract.validationErrors),
  );
}

export function createApiDocument(options: {
  title: string;
  version: string;
  basePath: string;
  contracts: readonly RouteContract[];
  components?: Parameters<typeof createDocument>[0]['components'];
}): ReturnType<typeof createDocument> {
  const paths: NonNullable<Parameters<typeof createDocument>[0]['paths']> = {};
  const operations = new Set<string>();

  for (const contract of options.contracts) {
    const path = contract.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
    const item = (paths[path] ??= {});

    if (item[contract.method] || operations.has(contract.operationId)) {
      throw new Error('api_contract_duplicate');
    }

    operations.add(contract.operationId);
    item[contract.method] = {
      operationId: contract.operationId,
      summary: contract.summary,
      description: contract.description,
      tags: contract.tags,
      security: contract.security,
      requestParams: {
        ...(contract.request.shape.params ? { path: contract.request.shape.params } : {}),
        ...(contract.request.shape.query ? { query: contract.request.shape.query } : {}),
        ...(contract.request.shape.headers ? { header: contract.request.shape.headers } : {}),
      },
      ...(contract.request.shape.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: contract.request.shape.body } } } }
        : {}),
      responses: contract.responses,
    };
  }

  return createDocument({
    openapi: '3.1.0',
    info: { title: options.title, version: options.version },
    servers: [{ url: options.basePath }],
    components: options.components,
    paths,
  });
}
