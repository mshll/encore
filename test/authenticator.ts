import { isoCBOR } from "@simplewebauthn/server/helpers";

const b64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString("base64url");
const sha256 = async (data: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));

function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0]! & 0x80) v = new Uint8Array([0, ...v]);
    return new Uint8Array([0x02, v.length, ...v]);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

export class SoftAuthenticator {
  private keys!: CryptoKeyPair;
  private readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
  private counter = 0;

  constructor(
    private readonly origin: string,
    private readonly rpId: string,
  ) {}

  async register(challenge: string) {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", this.keys.publicKey);
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]);
    const publicKey = isoCBOR.encode(cose);
    const authData = new Uint8Array([
      ...(await sha256(new TextEncoder().encode(this.rpId))),
      0x45,
      0,
      0,
      0,
      0,
      ...new Uint8Array(16),
      0,
      this.credentialId.length,
      ...this.credentialId,
      ...publicKey,
    ]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never);
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge, origin: this.origin, crossOrigin: false }));
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  async login(challenge: string) {
    this.counter++;
    const authData = new Uint8Array([
      ...(await sha256(new TextEncoder().encode(this.rpId))),
      0x05,
      (this.counter >>> 24) & 255,
      (this.counter >>> 16) & 255,
      (this.counter >>> 8) & 255,
      this.counter & 255,
    ]);
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge, origin: this.origin, crossOrigin: false }));
    const signed = new Uint8Array([...authData, ...(await sha256(clientDataJSON))]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, signed));
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(derSignature(raw)) },
      clientExtensionResults: {},
    };
  }
}
