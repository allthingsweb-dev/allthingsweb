import { HeadersFunction } from '@remix-run/node';

export const headers: HeadersFunction = ({ loaderHeaders, parentHeaders }) => {
  return setDefaultHeaders(new Headers(), {
    loaderHeaders,
    parentHeaders,
  });
};
export function setDefaultHeaders(
  headers: Headers,
  args: {
    loaderHeaders: Headers;
    parentHeaders: Headers;
  },
) {
  if (args.loaderHeaders.has('Server-Timing')) {
    headers.set('Server-Timing', args.loaderHeaders.get('Server-Timing')!);
  }
  if (args.parentHeaders.has('Server-Timing')) {
    headers.append('Server-Timing', args.parentHeaders.get('Server-Timing')!);
  }
  return headers;
}
