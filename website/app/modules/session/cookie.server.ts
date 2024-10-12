import { createCookieFactory, createCookieSessionStorageFactory } from '@remix-run/server-runtime';
import { sign, unsign } from './crypto.server.ts';

export const createCookie = createCookieFactory({ sign, unsign });
export const createCookieSessionStorage = createCookieSessionStorageFactory(createCookie);
