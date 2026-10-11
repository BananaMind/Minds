# Mobile access (P2P) — design and threat model

A bot that can run commands is remote code execution on your PC. So the question for mobile is not
"is the transport encrypted?" (it is) but **"who is allowed to connect, and what can they do?"**

## How it connects

```
phone (Capacitor app)  <—— WebRTC data channel (DTLS) ——>  PC host (mindsd)
          \                                                           /
           \—— encrypted offer/answer blobs via public MQTT brokers and WebTorrent trackers ——/
```

- **Data path:** a DTLS-encrypted WebRTC data channel, direct when possible or through your configured
  TURN relay. The relay forwards encrypted packets; it cannot read your chat.
- **Finding each other:** the two sides swap WebRTC offers/answers through whichever of several public
  services is reachable (MQTT brokers, WebTorrent trackers). They are used only as a mailbox: every blob is
  AES-GCM encrypted under a key the relays never see, and the room name is a hash. Relays can see that
  *something* is using a room (timing, IPs) but not who, what, or any content, and cannot forge or alter it.
- **NAT:** public STUN servers help establish direct connections. For restrictive mobile carriers or
  firewalls, configure Cloudflare TURN or a custom TURN server in **Profile & settings → Phone**.
  Cloudflare is hosted; you do not need a VPS. See [relay setup](RELAY.md).
- **Relay credentials:** updated phones request ICE settings over the encrypted signaling room before
  connecting, including on their first pairing. The Cloudflare API token stays on the PC. Only temporary
  relay credentials are sent to the phone, and connections renew before those credentials expire.

## Pairing (one time)

1. On the PC: *Profile & settings -> Phone -> Allow phones to connect -> Pair a phone* (or `minds phone pair`).
   Phone access is **off by default**.
2. A QR code appears: host public keys + a 128-bit one-time secret + a random room. It **works once** and
   expires in 5 minutes.
3. The phone scans it, finds the pairing room, and proves it knows the secret (HMAC bound to both nonces and
   its keys; the secret itself is never sent).
4. **You approve the phone by name on the PC.** Without that click nothing is added.
5. Both sides pin each other's keys. The phone verifies the PC's signature against the key from the QR.

## Every later connection

- The phone has its own ECDSA + ECDH keys (non-extractable WebCrypto keys, app-private storage; Android
  backup is disabled). The PC stores only public keys.
- The signaling room and SDP encryption key come from the static ECDH shared secret, so only a paired
  device can even ask to connect, and DTLS fingerprints are authenticated (no man-in-the-middle by a relay).
- The PC sends a fresh nonce; the phone signs it; the PC signs back. Failed attempts are rate limited.
- Revoke a phone any time (*Phone -> Remove*, or `minds phone revoke <name>`). Its session is cut immediately
  and its room is no longer listened to.

## What a paired phone can and can't do

| Can | Cannot |
|---|---|
| chat with bots, answer questions, approve/decline actions* | change settings, see or set API keys, sign in/out |
| read tool-call logs, search | shut down the host, pair or revoke phones |
| create bots, rename, change model/effort | delete bots |
| switch a bot between *default* and *ask* | switch a bot to **bypass permissions**, or create a bypass bot |
| use the mic (transcribed on the PC with your OpenRouter key) | read files or run commands directly (only through a bot) |

\* *Phones can approve risky actions* can be turned off on the PC.

## Residual risk (be aware)

- A stolen, unlocked, paired phone can tell your bots what to do, within each bot's permission mode. Use
  **ask for permission** mode on bots you don't want acting unattended, revoke lost phones, and lock your phone.
- Prompt injection is the same risk as on the desktop: a bot that reads hostile content might be steered.
- The device key is app-private but not hardware-backed yet (Android Keystore + biometric unlock is a good next step).
- There are no push notifications (they'd need a server): the phone sees updates while the app is open.
