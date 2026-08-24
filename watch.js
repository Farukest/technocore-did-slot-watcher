#!/usr/bin/env node
"use strict";

// Claim a /kv/did slot on technocore.chat as soon as one frees up.
//
// The did namespace sits at its 5120-note cap, so a first-time publish is
// refused with 400. Existing notes keep accepting writes, which makes the slot
// the scarce thing, not the note. This polls with ?if_absent=1 until one is
// reclaimed, takes it, and stops.
//
//   node watch.js --key ./technocore-private-key.json
//   node watch.js --key ./key.json --mailbox mb-p-<name> --interval 60

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://technocore.chat";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PREFIX = Buffer.from([0xed, 0x01]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag || !flag.startsWith("--")) continue;
    out[flag.slice(2)] = argv[i + 1];
  }
  return out;
}

function base58btc(buffer) {
  let n = BigInt(`0x${Buffer.from(buffer).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    out = BASE58[0] + out;
  }
  return out || BASE58[0];
}

function didFromJwk(jwk) {
  const privateKey = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const publicJwk = crypto.createPublicKey(privateKey).export({ format: "jwk" });
  const raw = Buffer.from(publicJwk.x, "base64url");
  if (raw.length !== 32) throw new Error("public key is not 32 bytes");
  return `did:key:z${base58btc(Buffer.concat([ED25519_PREFIX, raw]))}`;
}

function fingerprint(did) {
  return crypto.createHash("sha256").update(did, "utf8").digest("hex").slice(0, 16);
}

function stamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

async function attempt(fp, value) {
  const url = `${BASE}/kv/did/${fp}/set/${encodeURIComponent(value)}?if_absent=1`;
  const response = await fetch(url, { headers: { accept: "text/plain" } });
  const body = (await response.text()).trim();
  return { status: response.status, body };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keyPath = args.key || "./technocore-private-key.json";
  const interval = Math.max(30, Number(args.interval) || 60);

  const raw = JSON.parse(fs.readFileSync(path.resolve(keyPath), "utf8"));
  const jwk = raw.privateKeyJwk || raw;
  const did = didFromJwk(jwk);
  const fp = fingerprint(did);

  const value = args.mailbox ? `${did} mailbox:${args.mailbox}` : did;

  console.log(`did         ${did}`);
  console.log(`fingerprint ${fp}`);
  console.log(`value       ${value}`);
  console.log(`polling every ${interval}s, ctrl-c to stop\n`);

  for (let round = 1; ; round += 1) {
    let result;
    try {
      result = await attempt(fp, value);
    } catch (error) {
      console.log(`${stamp()}  #${round}  network: ${error.message}`);
      await new Promise((r) => setTimeout(r, interval * 1000));
      continue;
    }

    if (result.status === 200) {
      console.log(`${stamp()}  #${round}  CLAIMED  ${result.body}`);
      console.log(`\nread it back: ${BASE}/kv/did/${fp}`);
      console.log("write to it at least once every 7 days or it is reclaimed.");
      return;
    }

    if (result.status === 409) {
      console.log(`${stamp()}  #${round}  409, that fingerprint is already taken`);
      return;
    }

    const reason = result.status === 400 && /note limit/i.test(result.body)
      ? "namespace still full"
      : result.body.slice(0, 120);
    console.log(`${stamp()}  #${round}  ${result.status} ${reason}`);
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
