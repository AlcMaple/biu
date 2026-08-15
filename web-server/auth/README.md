# Web authentication boundary

The ordinary Web build authenticates through this same-origin BFF. The browser never receives a Bilibili Cookie or refresh token.

- `POST /__biu_auth/qrcode` creates a server-side QR transaction and returns only its random transaction ID and QR URL. A separate random `__Host-biu_login` Cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`) binds that transaction to the browser that created it. Creating another QR, reaching a terminal state, or completing login invalidates the old binding.
- `POST /__biu_auth/qrcode/poll` keeps the Bilibili `auth_code` on the server and rejects a leaked transaction ID presented without its matching browser binding. After Bilibili confirms the login, the BFF validates `SESSDATA`, `bili_jct`, the refresh token, and the returned identity before replacing any prior session. It then sets only `__Host-biu_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`).
- `GET /__biu_auth/session`, `POST /__biu_auth/session/refresh`, and `POST /__biu_auth/logout` operate on that server-side jar.
- The fixed-upstream Bilibili proxy calls `resolveSession(request, response)`, then uses `cookieHeaderFor(target)` for each exact upstream URL. `updateFromSetCookie(headers, responseUrl)` merges upstream rotation without returning Bilibili `Set-Cookie` to the browser. The jar records Domain, Path, and host-only scope, so same-name cookies from the five fixed Bilibili origins do not overwrite or leak into one another.
- Automatic Cookie status checks run at most once per session every two days, are single-flight, and continue the current API request with the existing jar instead of blocking it. A failed check observes the same cooldown. A confirmed upstream `401` destroys the server record in the background; the next request clears the opaque browser Cookie. The explicit refresh endpoint remains awaited so its result is visible to the user.
- `X-Biu-Csrf: inject` requires a server-side `bili_jct`. `X-Biu-Csrf: inject-if-present` supports Gaia for both anonymous and authenticated sessions. Both headers are BFF instructions only and must be stripped before forwarding upstream.

## Deployment boundary

Sessions are intentionally in memory. Restarting the Web server logs every Web user out; no Bilibili credential is written to disk. Production must serve the site and BFF under the same HTTPS origin because both `__Host-` Cookies are always `Secure`. Plain HTTP login is supported only on `localhost` and `127.0.0.1`; a LAN IP needs HTTPS. Run one Web server process unless a future deployment adds a shared, encrypted session store.

- Set `BIU_WEB_PUBLIC_ORIGIN` to the exact public origin (for example, `https://music.example`) behind TLS termination. Authentication mutations require both `Origin` and the unforwarded `Host` to match its scheme and host. Forwarded host/proto headers are not trusted.
- Optionally set `BIU_WEB_CLIENT_IP_HEADER` to one HTTP header name populated by a trusted reverse proxy. The proxy must remove any client-supplied value and write one canonical IP address; arrays and comma-separated chains are ignored. If unset, QR protection uses the global rate-limit bucket only.
- `BIU_WEB_TRUST_PROXY` and the old `resolveCookie(request)` integration are not supported. Do not restore generic `X-Forwarded-For` trust.
