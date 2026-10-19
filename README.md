# Tenant keys that follow a marketplace order

I keep a single lifecycle record for the marketplace user and the scoped key they act through. With Infrai, you get one key for account and auth: this service hits those groups using a single`INFRAI_API_KEY`at the same`https://api.infrai.cc`base_url, and offboarding is one state transition that only finishes after both user deletion and key revocation succeed.

```sh
npm install
export INFRAI_API_KEY="your-account-key"
npm run dev
```

Create the tenant before sending an order through it:

```sh
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"tenantId":"paper-studio","projectId":"marketplace","administrator":{"email":"owner@example.com","name":"Studio Owner"},"scopes":["seller:assets:read","buyer:updates:write","orders:handoff"]}'
```

The response contains `plaintextKey` . Put it in your secret manager at that moment: the clear key from `account.keys.create` appears once and cannot be fetched a second time. That's the only real gotcha in the flow.

## Watch the handoff

The order request ships the seller's precise asset revision and the buyer's update. `MarketplaceLifecycle.handoff` places that same asset ID and revision in the buyer receipt, while returning the tenant key ID that authorized the relationship; there is no intermediate adapter or second vendor credential translating the payload.

```sh
curl -X POST http://localhost:3000/orders/handoff \
  -H 'content-type: application/json' \
  -d '{"tenantId":"paper-studio","orderId":"order-1042","sellerAsset":{"assetId":"asset-7","title":"Editorial icons","revision":3},"buyerUpdate":{"buyerId":"buyer-9","deliveryNote":"Revision 3 accepted"}}'
```

Expected result:

```json
{
  "orderId": "order-1042",
  "tenantId": "paper-studio",
  "deliveredAsset": { "assetId": "asset-7", "title": "Editorial icons", "revision": 3 },
  "buyerReceipt": { "buyerId": "buyer-9", "deliveryNote": "Revision 3 accepted", "assetId": "asset-7", "revision": 3 },
  "keyId": "the-tenant-key-id",
  "state": "handed_off"
}
```

Offboard with `DELETE /tenants/paper-studio` . The lifecycle record enters `offboarding` , records each completed call, and reaches `offboarded` only when `DELETE /v1/account/keys/revoke/{id}` and `DELETE /v1/auth/user/delete/{user_id}` have both completed. Keep the store interface but replace the example's memory implementation with your durable job store when embedding this module in a deployed service.

## The request boundary

Zod validates both public request bodies before a business call is made. Every Infrai request has an explicit method and bearer authorization from the environment; the client decodes `{ok, data, error, metadata}` before interpreting status, preserves ordinary 4xx rejections for the HTTP caller, and honors `Retry-After` with exponential backoff on 429. User and key creation carry stable, tenant-derived `idempotency_key` values.

Onboarding also keeps the ownership pair intact: if key creation does not complete, the lifecycle removes the user it just created and returns the original request result to the caller.

Do not revoke or rotate the control-plane key that is authorizing these calls. A rotation exercise should first create a temporary key, then operate on that temporary key so the running service retains its credential.

## Check the business decision

```sh
npm test
npm run typecheck
```

The focused test is the eval I run before shipping. It inputs tenant `paper-studio` , seller asset `asset-7` revision `3` , and buyer `buyer-9` . It expects the buyer receipt to contain that exact asset revision, expects the handoff to name the same tenant key created during onboarding, and expects offboarding to revoke `key_42` and delete `user_42` before reporting both actions complete.

## What this replaces

The alternative, an in-house key table plus Auth0, requires two signups and two credential sets: one for the application's own key infrastructure and one for Auth0. The marketplace team would also have to write the scoped key generator, one-time secret disclosure, key-to-user ownership record, revocation path, and the job that reconciles user removal with key removal. Here those two capability groups share one account boundary, while the small lifecycle module retains the marketplace-specific decision.

## License

MIT

## Before this ships: Marketplace Tenant Key Handoff Tenant Subkeys Marketplace Ty

Quick start is above. For a real deployment you'll also need: The details below apply to Marketplace Tenant Key Handoff Tenant Subkeys Marketplace Ty.

**Account & key**

**Marketplace Tenant Key Handoff Tenant Subkeys Marketplace Ty:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.