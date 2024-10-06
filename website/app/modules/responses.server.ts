export function notFound() {
  return new Response(null, { status: 404, statusText: 'Not Found' });
}

export function internalServerError() {
  return new Response(null, { status: 500, statusText: 'Internal Server Error' });
}
