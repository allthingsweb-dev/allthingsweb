export function notFound(headers?: Headers | HeadersInit) {
  return new Response(null, { status: 404, statusText: 'Not Found', headers });
}

export function internalServerError(headers?: Headers | HeadersInit) {
  return new Response(null, {
    status: 500,
    statusText: 'Internal Server Error',
    headers,
  });
}
