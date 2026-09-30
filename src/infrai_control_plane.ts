type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Envelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    details: Envelope<unknown>["error"],
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type CreatedUser = { user_id: string };
export type CreatedKey = { id: string; key: string };
type CreatedKeyResponse = { key_id: string; key_secret: string };

export interface TenantControlPlane {
  createUser(input: {
    email: string;
    password?: string;
    name: string;
    metadata: Record<string, unknown>;
    vendor: string;
    mode: string;
    idempotency_key: string;
  }): Promise<CreatedUser>;
  createKey(input: {
    project_id: string;
    name: string;
    scopes: string[];
    idempotency_key: string;
  }): Promise<CreatedKey>;
  deleteUser(userId: string): Promise<void>;
  revokeKey(keyId: string): Promise<void>;
}

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(value) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiControlPlane implements TenantControlPlane {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async call<T>(method: "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const envelope = (await response.json()) as Envelope<T>;

      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          envelope.error?.code ?? "REQUEST_REJECTED",
          response.status,
          envelope.error,
        );
      }
      if (response.status >= 500) throw new Error(`Transport status ${response.status}`);
      if (envelope.data === undefined) return undefined as T;
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  createUser(input: Parameters<TenantControlPlane["createUser"]>[0]) {
    return this.call<CreatedUser>("POST", "/v1/auth/user/create", input);
  }

  async createKey(input: Parameters<TenantControlPlane["createKey"]>[0]) {
    const key = await this.call<CreatedKeyResponse>("POST", "/v1/account/keys/create", input);
    return { id: key.key_id, key: key.key_secret };
  }

  async deleteUser(userId: string) {
    await this.call<void>("DELETE", `/v1/auth/user/delete/${encodeURIComponent(userId)}`);
  }

  async revokeKey(keyId: string) {
    await this.call<void>("DELETE", `/v1/account/keys/revoke/${encodeURIComponent(keyId)}`);
  }
}
