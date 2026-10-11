# Phone connections over mobile data

Distance does not limit Minds connections. Your computer must stay awake and online,
and both networks must allow a connection. Some mobile carriers and home routers
prevent direct WebRTC connections. A TURN relay provides an alternative path.

## Cloudflare TURN (no VPS)

1. In your Cloudflare account, open **Realtime → TURN** and create a TURN key.
   Keep its **key ID** and the **API token associated with that TURN key**.
   See [Cloudflare's credential setup](https://developers.cloudflare.com/realtime/turn/generate-credentials/).
2. On the computer, open **Profile & settings → Phone → Mobile data & remote connections**.
3. Select **Cloudflare TURN**, paste the key ID and TURN API token, and click **Save relay**.
4. Click **Test saved relay**. This checks that the computer can obtain a TURN relay candidate.
5. Install the updated signed Android APK, turn off phone Wi-Fi, and reconnect over mobile data.

Existing paired phones do not need to be paired again. The updated app fetches relay
settings before connecting. The older app must be updated to use this feature.

The TURN API token remains on your computer. Minds generates temporary credentials
with a one-hour lifetime and sends them through encrypted signaling. The phone
reconnects before they expire; bots continue working on the computer during reconnects.
Cloudflare service usage follows your account's pricing and limits.

## Your own TURN server

Select **Custom TURN server**, enter its URLs, username and password, then save and test.
For example:

```text
turn:relay.example.com:3478?transport=udp
turns:relay.example.com:443?transport=tcp
```

These are placeholders: use the host and ports of your running TURN service.
UDP is useful for ordinary networks; TLS over TCP port 443 provides another option
when UDP is blocked. The server needs a valid TLS certificate for `turns:` and
firewall rules allowing its listening ports and configured relay port range.
Use authenticated credentials rather than an open relay.

## If connecting still fails

- **Test saved relay fails:** verify the saved credentials, TURN URLs, and the computer's network access.
- **Computer test passes, phone fails:** check the phone's connection log and try a TLS/TCP TURN URL.
  The computer test checks relay allocation, not the complete phone-to-computer connection.
- **Computer asleep or offline:** a relay cannot make it available. Keep it awake with Minds running.
- **Relay off:** Minds uses direct connections only, which may fail on mobile data.

Chat and tool traffic stays DTLS-encrypted through a TURN relay. Relay operators can
observe connection metadata and traffic volume. Pairing approval and phone permissions
are unchanged; see [mobile security](MOBILE.md).
