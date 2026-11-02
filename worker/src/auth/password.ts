
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 256;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveHash(
  password: string,
  salt: Uint8Array,
  pepper: string,
): Promise<Uint8Array> {
  if (encoder.encode(pepper).length < 32) {
    throw new Error("Password pepper must contain at least 32 bytes.");
  }

  const pepperKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const pepperedPassword = await crypto.subtle.sign(
    "HMAC",
    pepperKey,
    encoder.encode(password),
  );

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    pepperedPassword,
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH,
  );

  return new Uint8Array(derivedBits);
}

export async function hashPassword(
  password: string,
  pepper: string,
): Promise<string> {
  if (password.length < 12) {
    throw new Error("Password must contain at least 12 characters.");
  }

  if (encoder.encode(password).length > 1024) {
    throw new Error("Password is too long.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await deriveHash(password, salt, pepper);

  return [
    "pbkdf2",
    "sha256",
    PBKDF2_ITERATIONS,
    toBase64(salt),
    toBase64(hash),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  pepper: string,
): Promise<boolean> {
  try {
    const parts = storedHash.split("$");

    if (parts.length !== 5) return false;

    const [algorithm, digest, iterationsText, saltText, hashText] = parts;
    const iterations = Number(iterationsText);

    if (
      algorithm !== "pbkdf2" ||
      digest !== "sha256" ||
      iterations !== PBKDF2_ITERATIONS
    ) {
      return false;
    }

    const salt = fromBase64(saltText);
    const expectedHash = fromBase64(hashText);

    if (
      salt.length !== SALT_LENGTH ||
      expectedHash.length !== KEY_LENGTH / 8
    ) {
      return false;
    }

    const actualHash = await deriveHash(password, salt, pepper);

    let difference = 0;

    for (let i = 0; i < actualHash.length; i++) {
      difference |= actualHash[i] ^ expectedHash[i];
    }

    return difference === 0;
  } catch {
    return false;
  }
}
