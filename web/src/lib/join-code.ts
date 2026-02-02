import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateJoinCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = "";

  for (let i = 0; i < length; i += 1) {
    const index = bytes[i] % ALPHABET.length;
    code += ALPHABET[index];
  }

  return code;
}
