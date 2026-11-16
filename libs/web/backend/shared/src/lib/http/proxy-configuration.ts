/** Single-hop mode requires a sanitizing ingress and a trusted private network, with no raw TCP exposure. */
export function proxyConfiguration(value: string | undefined): { trustProxy?: string[] | 1 } {
  if (!value?.trim()) {
    return {};
  }

  if (value.trim() === '1-hop') {
    return { trustProxy: 1 };
  }

  return { trustProxy: value.split(',').map((address) => address.trim()) };
}
