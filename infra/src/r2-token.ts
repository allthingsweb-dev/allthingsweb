/**
 * A short-lived R2 token for one bucket, made by a maintainer's own
 * Cloudflare login (the cf CLI's, which may create account tokens) and
 * turned into the S3 credentials R2 takes. scripts/copy-media.ts makes one
 * for the run and deletes it after, so no token outlives the copy and
 * nobody ever creates or stores one by hand.
 */

/** Read and write, on objects only, in one bucket. */
export const bucketTokenPermissions = [
  "Workers R2 Storage Bucket Item Read",
  "Workers R2 Storage Bucket Item Write",
] as const;

/** The resource that names one bucket of an account (default jurisdiction). */
export const bucketResource = (accountId: string, bucket: string) =>
  `com.cloudflare.edge.r2.bucket.${accountId}_default_${bucket}`;

/**
 * The token's policies, from the account's permission groups: the two
 * above, on `bucket` alone. Fails if Cloudflare no longer has either group.
 */
export function bucketTokenPolicies(
  groups: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  accountId: string,
  bucket: string,
) {
  const ids = bucketTokenPermissions.map((name) => {
    const group = groups.find((candidate) => candidate.name === name);
    if (group === undefined) {
      throw new Error(`Cloudflare has no permission group "${name}"`);
    }
    return { id: group.id };
  });
  return [
    {
      effect: "allow",
      permission_groups: ids,
      resources: { [bucketResource(accountId, bucket)]: "*" },
    },
  ];
}

/**
 * R2's S3 credentials for an API token: the token's id is the access key,
 * and the SHA-256 of its value, in hex, the secret.
 */
export function s3CredentialsOf(token: {
  readonly id: string;
  readonly value: string;
}): { readonly accessKeyId: string; readonly secretAccessKey: string } {
  return {
    accessKeyId: token.id,
    secretAccessKey: new Bun.CryptoHasher("sha256")
      .update(token.value)
      .digest("hex"),
  };
}
