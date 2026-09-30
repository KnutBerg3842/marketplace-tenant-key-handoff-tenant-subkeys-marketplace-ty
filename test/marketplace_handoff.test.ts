import assert from "node:assert/strict";
import test from "node:test";
import type { TenantControlPlane } from "../src/infrai_control_plane.js";
import { InfraiControlPlane } from "../src/infrai_control_plane.js";
import { MarketplaceLifecycle, MemoryTenantStore } from "../src/marketplace_handoff.js";

test("normalizes the key creation response", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    ok: true,
    data: { key_id: "key_42", key_secret: "plain-key-once" },
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const controlPlane = new InfraiControlPlane("test-key", "https://example.test");
  const key = await controlPlane.createKey({
    project_id: "marketplace",
    name: "paper-studio-marketplace",
    scopes: ["orders:handoff"],
    idempotency_key: "key-paper-studio",
  });

  assert.deepEqual(key, { id: "key_42", key: "plain-key-once" });
  assert.equal(fetchMock.mock.calls[0].arguments[0], "https://example.test/v1/account/keys/create");
});

test("seller asset becomes the buyer receipt under the tenant key", async () => {
  const calls: string[] = [];
  const controlPlane: TenantControlPlane = {
    async createUser() { calls.push("create-user"); return { user_id: "user_42" }; },
    async createKey(input) { calls.push(`create-key:${input.scopes.join(",")}`); return { id: "key_42", key: "plain-key-once" }; },
    async revokeKey(id) { calls.push(`revoke:${id}`); },
    async deleteUser(id) { calls.push(`delete:${id}`); },
  };
  const lifecycle = new MarketplaceLifecycle(controlPlane, new MemoryTenantStore());
  const tenant = await lifecycle.onboard({
    tenantId: "paper-studio",
    projectId: "marketplace",
    administrator: { email: "owner@example.test", name: "Studio Owner" },
    scopes: ["seller:assets:read", "buyer:updates:write", "orders:handoff"],
  });
  const result = lifecycle.handoff({
    tenantId: "paper-studio",
    orderId: "order-1042",
    sellerAsset: { assetId: "asset-7", title: "Editorial icons", revision: 3 },
    buyerUpdate: { buyerId: "buyer-9", deliveryNote: "Revision 3 accepted" },
  });
  const offboarded = await lifecycle.offboard("paper-studio");

  assert.equal(result.deliveredAsset.assetId, result.buyerReceipt.assetId);
  assert.equal(result.deliveredAsset.revision, result.buyerReceipt.revision);
  assert.equal(result.keyId, tenant.keyId);
  assert.deepEqual(offboarded, { tenantId: "paper-studio", state: "offboarded", revoked: true, userDeleted: true });
  assert.deepEqual(calls, [
    "create-user",
    "create-key:seller:assets:read,buyer:updates:write,orders:handoff",
    "revoke:key_42",
    "delete:user_42",
  ]);
});
