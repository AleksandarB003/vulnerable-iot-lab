export function parsePublicParams(raw) {
  return {
    p: BigInt(raw.p),
    q: BigInt(raw.q),
    g: BigInt(raw.g),
  };
}

export function parseProof(raw) {
  return {
    params: parsePublicParams(raw.params),
    publicKey: BigInt(raw.publicKey),
    commitment: BigInt(raw.commitment),
    challenge: BigInt(raw.challenge),
    response: BigInt(raw.response),
  };
}