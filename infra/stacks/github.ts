import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const owner = "allthingsweb-dev";
const repository = "allthingsweb";

/**
 * The credentials GitHub Actions deploys the allthings stack with: an
 * account-owned Cloudflare token, written straight into the repository's
 * Actions secrets so its value is never shown or copied.
 *
 * Minting a token takes the account's Global API Key, so this stack is
 * deployed by hand with the `admin` profile (see README) and CI never holds
 * that key. Grant only what the allthings stack declares; widen the policies
 * here, in review, when it declares more.
 */
export default Alchemy.Stack(
  "allthings-github",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const zoneId = yield* Cloudflare.Zone.resolveZoneId({
      accountId,
      zone: "allthings.dev",
      hostname: "allthings.dev",
    }).pipe(Effect.orDie);
    const account = `com.cloudflare.api.account.${accountId}` as const;

    const token = yield* Cloudflare.ApiToken.AccountApiToken("DeployToken", {
      name: "allthings deploy (GitHub Actions)",
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            // Workers, their workers.dev routes and the media bucket.
            "Workers Scripts Write",
            "Workers R2 Storage Write",
            "Account Settings Read",
            // Alchemy's state store keeps its bearer token in the Secrets
            // Store and binds it to read it back, which needs Write.
            "Secrets Store Write",
          ],
          resources: { [account]: "*" },
        },
        {
          effect: "allow",
          // Custom domains on allthings.dev, such as media.allthings.dev.
          permissionGroups: ["Zone Read", "DNS Write", "Workers Routes Write"],
          resources: {
            [account]: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" },
          },
        },
      ],
    });

    yield* GitHub.Secret("CloudflareApiToken", {
      owner,
      repository,
      name: "CLOUDFLARE_API_TOKEN",
      value: token.value,
    });
    yield* GitHub.Secret("CloudflareAccountId", {
      owner,
      repository,
      name: "CLOUDFLARE_ACCOUNT_ID",
      value: Redacted.make(accountId),
    });

    return { tokenId: token.tokenId };
  }),
);
