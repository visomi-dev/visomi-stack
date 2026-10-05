function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

/** Exercise the current session-bound password signup contract, not legacy challenge IDs. */
export async function createVerifiedPasswordAccount(
  apiUrl: string,
  origin: string,
  email: string,
  password: string,
): Promise<string> {
  const signup = await fetch(`${apiUrl}/auth/password/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  const pending = (await signup.json()) as { data?: { flowId?: string } };
  const cookie = sessionCookie(signup);

  if (!signup.ok || !pending.data?.flowId || !cookie) {
    throw new Error('The OpenAPI password signup fixture did not create a bound verification flow.');
  }
  const mailbox = await fetch(
    `${apiUrl}/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=password_signup`,
  );
  const delivery = (await mailbox.json()) as { pin?: string };

  if (!mailbox.ok || !delivery.pin) throw new Error('The OpenAPI password signup fixture did not receive a code.');
  const verification = await fetch(`${apiUrl}/auth/password/sign-up/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
    body: JSON.stringify({ flowId: pending.data.flowId, code: delivery.pin }),
  });
  const verifiedCookie = sessionCookie(verification);

  if (!verification.ok || !verifiedCookie) throw new Error('The OpenAPI password signup fixture was not verified.');

  return verifiedCookie;
}
