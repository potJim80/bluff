// Hands travel over a public broker, so anyone who knows the room code could read them. Each
// phone makes a key pair, the screen makes one, and the two agree on a shared key (ECDH). The
// screen seals each hand with that phone's key, and the phone seals its moves the same way, so
// nobody else can read a hand or make a move in someone else's name.
// Works in browsers (https or localhost) and in Node.

const subtle = globalThis.crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// A key pair, saved as JSON so it survives a reload.
export async function makeKeys() {
  const k = await subtle.generateKey(ECDH, true, ['deriveKey']);
  return { pub: b64(await subtle.exportKey('raw', k.publicKey)), priv: await subtle.exportKey('jwk', k.privateKey) };
}

export async function shared(myKeys, theirPub) {
  const priv = await subtle.importKey('jwk', myKeys.priv, ECDH, false, ['deriveKey']);
  const pub = await subtle.importKey('raw', unb64(theirPub), ECDH, false, []);
  return subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(key, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: b64(iv), ct: b64(ct) };
}

// null if it wasn't sealed with this key (or was tampered with).
export async function open(key, box) {
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}
