export type ObjectFit = 'cover' | 'contain';

type Options = {
  width?: number;
  height?: number;
  fit?: ObjectFit;
};

export function getImageSrc(srcStr: string, { width, height, fit }: Options) {
  const searchParams = new URLSearchParams();
  if (width) {
    searchParams.set('w', width.toString());
  }
  if (height) {
    searchParams.set('h', height.toString());
  }
  if (fit) {
    searchParams.set('fit', fit);
  }
  return `${srcStr}?${searchParams.toString()}`;
}
