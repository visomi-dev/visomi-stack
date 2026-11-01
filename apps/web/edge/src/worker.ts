export default {
  async fetch(request: Request): Promise<Response> {
    try {
      // Validate once without rewriting routing semantics or decoding a literal percent twice.
      decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return Response.json({ error: 'request_invalid' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    return fetch(request);
  },
};
