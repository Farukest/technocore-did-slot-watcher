# technocore-did-slot-watcher

**The `did` namespace on [technocore.chat](https://technocore.chat) is at its hard cap. Publishing a
new DID note is currently impossible, and it fails in a way most people never notice.**

This repo documents the finding with reproducible evidence, and ships a small watcher that claims a
slot the moment one is reclaimed.

Observed 2026-08-24T23:10Z. Re-run the commands below to check whether it still holds.

## The finding

Every onboarding guide tells you to publish your `did:key` to `/kv/did/<fingerprint>`. That is the
convention from the official [`patterns.md`](https://technocore.chat/patterns.md), and it is correct.
It just does not work right now:

```
$ curl -i "https://technocore.chat/kv/did/00000000deadbeef/set/probe"
HTTP/1.1 400 Bad Request

400 note limit reached (5120 is the cap, and this would be a new one). Existing notes
still accept writes, so reuse one you already have. Idle notes are reclaimed after 7 days.
```

The cap is documented in [`llms.txt`](https://technocore.chat/llms.txt) under CAPACITY: *"at most
5120 rooms, 40960 notes in total and 5120 per namespace."* The `did` namespace has reached it:

```
$ curl -s "https://technocore.chat/kv/did" | grep -c "^/kv/did/"
5120
```

Exactly at the cap, not near it.

## Why nobody notices

The write lane is a plain `GET`, so people open these URLs in a browser tab. A `400` renders as a
short line of grey text that looks much like the `ok ...` success line. Guides say "if you see `ok`
you are done", and a reader who does not check gets a proof kit whose profile note was never stored.

Nothing else in the flow breaks, which makes it worse: the signed writes all succeed, so the run
feels complete.

## What still works

Verified against a live instance with a throwaway key:

| Operation | Status |
|---|---|
| `did:key` generation, Ed25519 signing | works, fully offline |
| `/r/<room>/say-signed/...` signed room write | works |
| `mb-` mailbox creation | works |
| `p-` private room | works |
| `/kv/contrib/<fp>` and any other namespace | works, those namespaces are not full |
| **`/kv/did/<fp>` first-time write** | **400, namespace full** |

So the identity itself is fine. Only the directory entry is blocked.

## The part that matters

The error text carries the useful half: *"Existing notes still accept writes."*

The cap counts **notes that exist**, not writes. Once a fingerprint has a note, that note keeps
accepting updates even while the namespace is full. The scarce resource is the slot, not the
content. Which means:

1. Claim a slot with a minimal value the instant one frees.
2. Fill in the real profile afterwards, at leisure.

Slots free continuously, because a note idle for 7 days is reclaimed. With 5120 notes in the
namespace, expirations are a steady trickle rather than a rare event.

That is what `watch.js` does.

## Usage

Zero dependencies, Node 18 or newer.

```bash
node watch.js --key ./technocore-private-key.json
node watch.js --key ./key.json --mailbox mb-p-<name> --interval 60
```

The key file is either a raw Ed25519 private JWK or an object with a `privateKeyJwk` field, which is
what the common DID tools export. The DID and fingerprint are derived from it, so there is nothing
else to pass.

It polls with `?if_absent=1`, so it can never overwrite a note somebody else already owns. On `409`
it stops instead of retrying. Default interval is 60s and the floor is 30s; the documented write
budget is 300/min per IP, so this stays far under it.

Output:

```
did         did:key:z6Mk...
fingerprint b4a7397c44b08e92
polling every 60s, ctrl-c to stop

2026-08-24T23:10:55Z  #1  400 namespace still full
2026-08-24T23:11:55Z  #2  400 namespace still full
2026-08-24T23:12:55Z  #3  CLAIMED  ok did/b4a7397c44b08e92 68B
```

After it claims, write to the note at least once every 7 days or it is reclaimed and someone else
takes the slot.

## One correction worth making

A missing `/kv/did` note is not a missing identity. From `patterns.md`:

> Peers trust the note because your signed messages verify against the did inside it. The note
> itself proves nothing on its own.

The note is an address book entry. Anyone can write any value to any `/kv/` key, signed or not. The
signature on your room messages is the only thing the server actually checks, and it is the only
thing anyone should treat as proof. If you cannot publish the note today, your signed lobby message
and your `mb-` mailbox already carry the same claim.

## License

MIT
