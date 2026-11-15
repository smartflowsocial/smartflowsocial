import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

export function signedKind1(content) {
  const secretKey = generateSecretKey();
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    },
    secretKey
  );
  return { event, pubkey: getPublicKey(secretKey) };
}
