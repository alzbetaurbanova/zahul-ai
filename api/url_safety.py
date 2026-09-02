"""Guards for server-side HTTP fetches (SSRF mitigation)."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

_FORBIDDEN_HOSTNAMES = frozenset(
    {
        "localhost",
        "metadata.google.internal",
        "metadata",
        "kubernetes",
        "kube-dns",
    }
)


def validate_public_https_url(url: str) -> None:
    """
    Ensure URL uses https and the hostname resolves only to public routable addresses.
    Raises fastapi.HTTPException on failure (import deferred to avoid circular imports).
    """
    from fastapi import HTTPException

    parsed = urlparse((url or "").strip())
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="Only https URLs are allowed.")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="Invalid URL.")
    hl = host.lower()
    if hl in _FORBIDDEN_HOSTNAMES or hl.endswith(".local"):
        raise HTTPException(status_code=400, detail="Host not allowed.")
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve host.")
    for info in infos:
        addr = info[4][0]
        try:
            ip_obj = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_reserved
            or ip_obj.is_multicast
        ):
            raise HTTPException(
                status_code=400,
                detail="URL resolves to a non-public address.",
            )


def _host_resolves_only_to_loopback(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        addr = info[4][0]
        try:
            ip_obj = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if not ip_obj.is_loopback:
            return False
    return True


def validate_proxy_image_url(url: str) -> None:
    """
    https: same rules as validate_public_https_url (public hosts only).
    http: allowed only when the hostname resolves exclusively to loopback addresses
    (typical local dev: localhost, 127.0.0.1, ::1).
    """
    from fastapi import HTTPException

    parsed = urlparse((url or "").strip())
    scheme = (parsed.scheme or "").lower()
    if scheme == "https":
        validate_public_https_url(url)
        return
    if scheme != "http":
        raise HTTPException(
            status_code=400,
            detail="Only https URLs are allowed, or http for localhost development.",
        )
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="Invalid URL.")
    hl = host.lower()
    if hl in _FORBIDDEN_HOSTNAMES or hl.endswith(".local"):
        raise HTTPException(status_code=400, detail="Host not allowed.")
    if not _host_resolves_only_to_loopback(host):
        raise HTTPException(
            status_code=400,
            detail="http is only allowed when the host resolves to loopback (e.g. localhost, 127.0.0.1).",
        )


# Redirect codes httpx treats as redirects.
_REDIRECT_STATUS = frozenset({301, 302, 303, 307, 308})


async def safe_image_fetch(
    url: str,
    *,
    headers: dict | None = None,
    timeout: float = 10.0,
    max_redirects: int = 5,
) -> httpx.Response:
    """
    SSRF-safe GET for server-side image fetches.

    Redirects are followed MANUALLY, re-validating every hop against
    validate_proxy_image_url. This closes the redirect-bypass where a public
    URL 302s to an internal/loopback/metadata address (httpx follow_redirects
    would otherwise skip validation on the redirected request).

    Raises fastapi.HTTPException on any disallowed hop or too many redirects.
    """
    from fastapi import HTTPException

    current = (url or "").strip()
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        for _ in range(max_redirects + 1):
            # DNS resolution inside the validator is blocking -> off the event loop.
            await asyncio.to_thread(validate_proxy_image_url, current)
            resp = await client.get(current, headers=headers or {})
            if resp.status_code in _REDIRECT_STATUS and resp.headers.get("location"):
                current = urljoin(current, resp.headers["location"])
                continue
            return resp
    raise HTTPException(status_code=400, detail="Too many redirects.")
