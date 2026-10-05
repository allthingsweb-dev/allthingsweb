import { describe, expect, test } from "bun:test";
import {
  bucketResource,
  bucketTokenPolicies,
  s3CredentialsOf,
} from "../src/r2-token.ts";

describe("a token for one bucket", () => {
  const groups = [
    { id: "r", name: "Workers R2 Storage Bucket Item Read" },
    { id: "w", name: "Workers R2 Storage Bucket Item Write" },
    { id: "all", name: "Workers R2 Storage Write" },
  ];

  test("may read and write that bucket's objects, and nothing else", () => {
    expect(bucketTokenPolicies(groups, "acct", "allthings-media")).toEqual([
      {
        effect: "allow",
        permission_groups: [{ id: "r" }, { id: "w" }],
        resources: {
          "com.cloudflare.edge.r2.bucket.acct_default_allthings-media": "*",
        },
      },
    ]);
    expect(bucketResource("acct", "b")).toBe(
      "com.cloudflare.edge.r2.bucket.acct_default_b",
    );
  });

  test("fails when Cloudflare no longer has a permission group", () => {
    expect(() =>
      bucketTokenPolicies(groups.slice(1), "acct", "allthings-media"),
    ).toThrow('no permission group "Workers R2 Storage Bucket Item Read"');
  });

  test("becomes S3 credentials: the id, and the value's SHA-256 in hex", () => {
    expect(s3CredentialsOf({ id: "abc", value: "secret" })).toEqual({
      accessKeyId: "abc",
      secretAccessKey:
        "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b",
    });
  });
});
