import type { SignFunction, UnsignFunction } from "@remix-run/server-runtime";
import cookieSignature from "cookie-signature";

// deno-lint-ignore require-await
export const sign: SignFunction = async (value, secret) => {
  return cookieSignature.sign(value, secret);
};

// deno-lint-ignore require-await
export const unsign: UnsignFunction = async (
  signed: string,
  secret: string
) => {
  const unsignedValue = cookieSignature.unsign(signed, secret);
  if(typeof unsignedValue === 'boolean') {
    return false;
  }
  return unsignedValue;
};