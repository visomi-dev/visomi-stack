import { RailwayS3ObjectStore } from './opaque-sync-object-store';

describe('RailwayS3ObjectStore', () => {
  it('uses the configured bucket and sends opaque bytes without logging or parsing them', async () => {
    const requests: Array<{ url: string; body?: BodyInit }> = [];
    const fetcher = jest.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: input.toString(), body: init?.body as BodyInit | undefined });

      return new Response(null, { status: 200 });
    });
    const store = new RailwayS3ObjectStore(
      {
        endpoint: 'https://objects.example.test',
        bucket: 'ciphertext-only',
        accessKey: 'access',
        secretKey: 'secret',
      },
      fetcher,
    );
    const payload = new TextEncoder().encode('{"ciphertext":"opaque"}');

    await store.put('account/workspace/envelope.json', payload);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requests[0].url).toContain('/ciphertext-only/account/workspace/envelope.json');
    expect(requests[0].body).toBe(payload);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({
        authorization: expect.stringContaining('AWS4-HMAC-SHA256'),
        'x-amz-content-sha256': expect.any(String),
      }),
    );
  });

  it('maps a missing object to undefined for reference consistency checks', async () => {
    const fetcher = jest.fn(async () => new Response(null, { status: 404 }));
    const store = new RailwayS3ObjectStore(
      {
        endpoint: 'https://objects.example.test',
        bucket: 'ciphertext-only',
        accessKey: 'access',
        secretKey: 'secret',
      },
      fetcher,
    );

    await expect(store.get('missing')).resolves.toBeUndefined();
  });
});
