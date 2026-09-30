import { createHash } from "node:crypto";
import { z } from "zod";
import type { CreatedKey, TenantControlPlane } from "./infrai_control_plane.js";

export const tenantRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(80),
  projectId: z.string().trim().min(1).max(120),
  administrator: z.object({
    email: z.string().email(),
    password: z.string().min(12).optional(),
    name: z.string().trim().min(1).max(100),
  }),
  scopes: z.array(z.string().trim().min(1)).min(1),
});

export const orderRequestSchema = z.object({
  tenantId: z.string().trim().min(1),
  sellerAsset: z.object({
    assetId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    revision: z.number().int().positive(),
  }),
  buyerUpdate: z.object({
    buyerId: z.string().trim().min(1),
    deliveryNote: z.string().trim().min(1),
  }),
  orderId: z.string().trim().min(1),
});

export type TenantRequest = z.infer<typeof tenantRequestSchema>;
export type OrderRequest = z.infer<typeof orderRequestSchema>;

type TenantRecord = {
  tenantId: string;
  userId: string;
  keyId: string;
  scopes: string[];
  state: "active" | "offboarding" | "offboarded";
  revoked: boolean;
  userDeleted: boolean;
};

export interface TenantStore {
  get(tenantId: string): TenantRecord | undefined;
  put(record: TenantRecord): void;
}

export class MemoryTenantStore implements TenantStore {
  private readonly records = new Map<string, TenantRecord>();
  get(tenantId: string) { return this.records.get(tenantId); }
  put(record: TenantRecord) { this.records.set(record.tenantId, { ...record }); }
}

function operationId(prefix: string, tenantId: string): string {
  return `${prefix}-${createHash("sha256").update(tenantId).digest("hex").slice(0, 24)}`;
}

export class MarketplaceLifecycle {
  private readonly controlPlane: TenantControlPlane;
  private readonly store: TenantStore;

  constructor(
    controlPlane: TenantControlPlane,
    store: TenantStore,
  ) {
    this.controlPlane = controlPlane;
    this.store = store;
  }

  async onboard(raw: unknown): Promise<TenantRecord & { plaintextKey: string }> {
    const input = tenantRequestSchema.parse(raw);
    const user = await this.controlPlane.createUser({
      email: input.administrator.email,
      password: input.administrator.password,
      name: input.administrator.name,
      metadata: { tenantId: input.tenantId },
      vendor: "infrai",
      mode: "marketplace",
      idempotency_key: operationId("user", input.tenantId),
    });
    let key: CreatedKey;
    try {
      key = await this.controlPlane.createKey({
        project_id: input.projectId,
        name: `${input.tenantId}-marketplace`,
        scopes: input.scopes,
        idempotency_key: operationId("key", input.tenantId),
      });
    } catch (error) {
      await this.controlPlane.deleteUser(user.user_id);
      throw error;
    }
    const record: TenantRecord = {
      tenantId: input.tenantId,
      userId: user.user_id,
      keyId: key.id,
      scopes: input.scopes,
      state: "active",
      revoked: false,
      userDeleted: false,
    };
    this.store.put(record);
    return { ...record, plaintextKey: key.key };
  }

  handoff(raw: unknown) {
    const input = orderRequestSchema.parse(raw);
    const tenant = this.store.get(input.tenantId);
    if (!tenant || tenant.state !== "active") throw new Error("Tenant is not active");
    return {
      orderId: input.orderId,
      tenantId: input.tenantId,
      deliveredAsset: input.sellerAsset,
      buyerReceipt: {
        buyerId: input.buyerUpdate.buyerId,
        deliveryNote: input.buyerUpdate.deliveryNote,
        assetId: input.sellerAsset.assetId,
        revision: input.sellerAsset.revision,
      },
      keyId: tenant.keyId,
      state: "handed_off" as const,
    };
  }

  async offboard(tenantId: string) {
    const record = this.store.get(tenantId);
    if (!record) throw new Error("Tenant was not found");
    record.state = "offboarding";
    this.store.put(record);

    const actions: Promise<void>[] = [];
    if (!record.revoked) actions.push(this.controlPlane.revokeKey(record.keyId).then(() => { record.revoked = true; this.store.put(record); }));
    if (!record.userDeleted) actions.push(this.controlPlane.deleteUser(record.userId).then(() => { record.userDeleted = true; this.store.put(record); }));
    await Promise.all(actions);

    record.state = "offboarded";
    this.store.put(record);
    return { tenantId, state: record.state, revoked: record.revoked, userDeleted: record.userDeleted };
  }
}
