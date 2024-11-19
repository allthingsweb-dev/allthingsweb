import Bun from 'bun';
import sharp from 'sharp';
import nodeFetch from 'node-fetch';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LoaderFunctionArgs } from '@remix-run/node';
import { notFound, internalServerError } from '~/modules/responses.server';
import { captureException } from '~/modules/sentry/capture.server';
import { type ObjectFit } from '~/modules/image-opt/utils';

export { headers } from '~/modules/header.server';

function getIntOrNull(value: string | null) {
  if (value === null) {
    return null;
  }

  return Number.parseInt(value);
}

function getObjectFit(fit: string | null): ObjectFit {
  if (fit === 'contain') {
    return 'contain';
  }

  return 'cover';
}

type ImageType = 'public' | 'gen' | 'pocketbase';

function getFilePath(
  type: ImageType,
  fileId: string,
  width: number | null,
  height: number | null,
  fit: 'cover' | 'contain',
) {
  const widthInfo = `w${width || '0'}`;
  const heightInfo = `h${height || '0'}`;
  const fileName = fileId.replace(/\/./g, '-');
  return `data/images/${type}/v1-${fileName}-${widthInfo}-${heightInfo}-${fit}.webp`;
}

/**
 * Inspired by Jacob Eybey's gist: https://gist.github.com/jacob-ebey/3a37a86307de9ef22f47aae2e593b56f
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { time, getHeaderField, getServerTimingHeader } = context.serverTimingsProfiler;

  const url = new URL(request.url);
  const width = getIntOrNull(url.searchParams.get('w'));
  const height = getIntOrNull(url.searchParams.get('h'));
  const fit = getObjectFit(url.searchParams.get('fit'));
  if (Number.isNaN(width) || Number.isNaN(height)) {
    return new Response('w and h query parameters must be numbers', {
      status: 400,
      statusText: 'Bad Request',
    });
  }

  let filePath: string | null = null;
  let originUrl: string | null = null;

  // path: /img/pocketbase/x/y/z.png for images hosted on pocketbase
  if (url.pathname.startsWith('/img/pocketbase/')) {
    const urlPath = url.pathname;
    const pocketbaseFileId = urlPath.replace('/img/pocketbase/', '');
    filePath = getFilePath('pocketbase', pocketbaseFileId, width, height, fit);
    const thumb = width && height ? `thumb=${width}x${height}` : '';
    originUrl = `${context.mainConfig.pocketbase.origin}/api/files/${pocketbaseFileId}?${thumb}`;
  }

  // path: /img/public/x/y/z.png for images in public folder
  if (url.pathname.startsWith('/img/public/')) {
    const urlPath = url.pathname;
    const publicFileId = urlPath.replace('/img/public/', '');
    filePath = getFilePath('public', publicFileId, width, height, fit);
    originUrl = `${context.mainConfig.origin}/${publicFileId}`;
  }

  // path: /img/gen/x/y/z.png for images generated via modules/image-gen
  if (url.pathname.startsWith('/img/gen/')) {
    const urlPath = url.pathname;
    const genFileId = urlPath.replace('/img/gen/', '');
    filePath = getFilePath('gen', genFileId, width, height, fit);
    originUrl = `${context.mainConfig.origin}/${genFileId}`;
  }

  if (!filePath || !originUrl) {
    return notFound();
  }

  const cachedFile = Bun.file(filePath);
  if (await cachedFile.exists()) {
    return new Response(cachedFile.stream(), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': `public, max-age=${60 * 60 * 24}`,
      },
    });
  }

  context.logger.log('Cache miss, fetching image from origin:', originUrl);
  // Using node-fetch to get a node:stream compatible response
  const res = await time('fetchImg', () => nodeFetch(originUrl));
  if (!res.ok || !res.body) {
    return internalServerError(getServerTimingHeader());
  }
  const sharpInstance = sharp();
  sharpInstance.on('error', (error) => {
    console.error(error);
    captureException(error);
  });
  if (width || height) {
    sharpInstance.resize(width, height, { fit });
  }
  sharpInstance.webp({ effort: 6 });

  await time(
    'mkdirFileDir',
    fsp.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {}),
  );

  const transformStream = res.body.pipe(sharpInstance);
  try {
    const cacheFileStream = fs.createWriteStream(filePath);
    await time(
      'transformImage',
      new Promise<void>((resolve, reject) => {
        transformStream.pipe(cacheFileStream);
        transformStream.on('end', () => {
          resolve();
        });
        transformStream.on('error', async (error: Error) => {
          await fsp.rm(filePath).catch(() => {});
          reject(error);
        });
      }),
    );

    return new Response(Bun.file(filePath).stream(), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': `public, max-age=${60 * 60 * 24}`, // cache img 24 hours in browser
        'Server-Timing': getHeaderField(),
      },
    });
  } catch (error) {
    console.error(error);
    captureException(error);
    return internalServerError(getServerTimingHeader());
  }
}
