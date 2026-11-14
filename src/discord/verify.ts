const keys = new Map<string, Promise<CryptoKey>>();

const hex = (value: string) => (/^[0-9a-f]*$/i.test(value) && value.length % 2 === 0 ? Uint8Array.from(Buffer.from(value, "hex")) : null);

function importKey(publicKeyHex: string): Promise<CryptoKey> {
  let key = keys.get(publicKeyHex);
  if (!key) {
    key = crypto.subtle.importKey("raw", hex(publicKeyHex)!, { name: "Ed25519" }, false, ["verify"]);
    keys.set(publicKeyHex, key);
  }
  return key;
}

export async function verifyDiscordSignature(publicKeyHex: string, signature: string | undefined, timestamp: string | undefined, body: string): Promise<boolean> {
  const sig = signature ? hex(signature) : null;
  if (!sig || sig.length !== 64 || !timestamp) return false;
  return crypto.subtle.verify({ name: "Ed25519" }, await importKey(publicKeyHex), sig, new TextEncoder().encode(timestamp + body));
}
