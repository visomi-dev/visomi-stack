import type { Request, Response } from 'express';

import type { AuthRuntime } from '../runtime';
import { requirePrincipal } from '../shared/http';

export async function getMethods(auth: AuthRuntime, request: Request, response: Response) {
  const methods = await auth.methods.overview(requirePrincipal(request));

  response.json(methods);
}
