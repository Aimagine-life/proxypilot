# Privacy Policy — ProxyPilot

_Last updated: 2026-06-23_

ProxyPilot is a Chromium/Firefox browser extension that routes user-selected domains
through a proxy server. This policy describes what data the extension handles.

## In short

**ProxyPilot does not collect, store on any server, or share with third parties any
personal data, browsing history, or page content.**

## What data is handled, and where

All data is stored **locally** in the user's browser (`chrome.storage` / `storage`) and
never leaves the device:

- Settings: chosen services/domains to route, the selected proxy source, your proxy
  address and credentials (if you entered them), and the theme.
- Technical cache: the public free-proxy lists and a domain blocklist — so the extension
  works without constant downloads.

Your proxy credentials are used solely to connect to that proxy and are stored locally
only.

## Network requests

The extension makes external requests only for its own operation:

- Downloading public free-proxy lists (GitHub/CDN) — configuration data, not user data.
- Downloading a domain blocklist — used to mark domains that must not be routed.
- Small test requests to check whether a proxy is alive.
- When checking a proxy, its IP address is sent to the third-party service `ipinfo.io`
  to determine the proxy server's country/city and display them in the UI. This sends
  the **proxy server's** IP, not your personal IP.

These requests do not contain your personal information.

## Page content

The extension **does not read, modify, or transmit** the content of the pages you visit.
The all-sites host permission is used only to apply routing rules, because the list of
routed domains is defined by you.

## Free proxy pool

Free public proxies are operated by third parties and are not controlled by the
developer. Do not use them to sign into important accounts. The developer is not
responsible for the operation of third-party proxy servers.

## Analytics and tracking

The extension uses **no** analytics, ad networks, tracking cookies, or other tracking.

## Changes

If this policy changes, the date at the top will be updated.

## Contact

Wildbots — https://wildbots.ru/ · Telegram: https://t.me/romankov_k
