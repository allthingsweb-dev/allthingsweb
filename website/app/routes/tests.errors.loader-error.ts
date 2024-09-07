export function loader() {
  throw new Error('This is a test error from a Remix loader');
}

export default function Component() {
  return 'This is a test page';
}
