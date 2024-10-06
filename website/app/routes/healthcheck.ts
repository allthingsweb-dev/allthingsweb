export function loader() {
  return new Response('OK', {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}
