export function notFound() {
  return new Response(null, { status: 404, statusText: 'Not Found' });
}
