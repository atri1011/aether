#!/usr/bin/env python3
"""Deploy aether to VPS via Docker + nginx."""
from __future__ import annotations

import secrets
import string
import sys
import time
from pathlib import Path

import paramiko

import os

HOST = os.environ.get("AETHER_SSH_HOST", "156.238.228.203")
PORT = int(os.environ.get("AETHER_SSH_PORT", "22"))
USER = os.environ.get("AETHER_SSH_USER", "root")
# Pass via env: set AETHER_SSH_PASSWORD before running (do not commit secrets).
PASSWORD = os.environ.get("AETHER_SSH_PASSWORD") or ""
REMOTE_ROOT = os.environ.get("AETHER_REMOTE_ROOT", "/opt/aether")

LOCAL_ROOT = Path(__file__).resolve().parents[1]


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 1800) -> tuple[int, str]:
    print(f"\n>>> {cmd[:220]}", flush=True)
    chan = client.get_transport().open_session()
    chan.settimeout(timeout)
    chan.get_pty(width=160, height=40)
    chan.exec_command(cmd)
    out: list[str] = []
    while True:
        if chan.recv_ready():
            data = chan.recv(8192).decode("utf-8", "replace")
            out.append(data)
            print(data, end="", flush=True)
        if chan.exit_status_ready():
            while chan.recv_ready():
                data = chan.recv(8192).decode("utf-8", "replace")
                out.append(data)
                print(data, end="", flush=True)
            break
        time.sleep(0.15)
    code = chan.recv_exit_status()
    print(f"\n[exit={code}]", flush=True)
    return code, "".join(out)


def put_text(sftp: paramiko.SFTPClient, remote: str, content: str) -> None:
    with sftp.file(remote, "w") as f:
        f.write(content)
    print("wrote", remote)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASSWORD,
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )

    # Ensure repo present
    code, _ = run(
        client,
        "set -e; mkdir -p /opt; "
        "if [ -d /opt/aether/.git ]; then "
        "  cd /opt/aether && git fetch origin && git reset --hard origin/main; "
        "else "
        "  git clone --depth 1 https://github.com/atri1011/aether.git /opt/aether; "
        "fi; "
        "cd /opt/aether && git log -1 --oneline && ls",
    )
    if code != 0:
        print("CLONE_FAILED")
        return 1

    # Reuse existing secrets if present
    code, env_out = run(
        client,
        "if [ -f /opt/aether/.env ]; then grep -E '^(SITE_PASSWORD|AUTH_SECRET)=' /opt/aether/.env || true; else echo NEED_ENV; fi",
    )
    site_password = None
    auth_secret = None
    for line in env_out.splitlines():
        if line.startswith("SITE_PASSWORD="):
            site_password = line.split("=", 1)[1].strip()
        if line.startswith("AUTH_SECRET="):
            auth_secret = line.split("=", 1)[1].strip()
    if not site_password:
        alphabet = string.ascii_letters + string.digits
        site_password = "Aether-" + "".join(secrets.choice(alphabet) for _ in range(16))
    if not auth_secret:
        auth_secret = secrets.token_hex(32)

    print("SITE_PASSWORD=", site_password)
    print("AUTH_SECRET=", auth_secret)

    env_content = (
        "PORT=8787\n"
        "NODE_ENV=production\n"
        "CACHE_DIR=/app/.cache/aether\n"
        f"SITE_PASSWORD={site_password}\n"
        f"AUTH_SECRET={auth_secret}\n"
        "AUTH_TTL_HOURS=168\n"
        "AUTH_SECURE_COOKIE=1\n"
    )

    creds = (
        "AETHER deploy credentials\n"
        "URL: https://ljl.050415.xyz\n"
        f"SITE_PASSWORD: {site_password}\n"
        f"AUTH_SECRET: {auth_secret}\n"
        "App dir: /opt/aether\n"
        "Runtime: Docker (container aether)\n"
        "Update: cd /opt/aether && git pull && docker compose up -d --build\n"
    )

    files = {
        f"{REMOTE_ROOT}/Dockerfile": (LOCAL_ROOT / "Dockerfile").read_text(encoding="utf-8"),
        f"{REMOTE_ROOT}/docker-compose.yml": (LOCAL_ROOT / "docker-compose.yml").read_text(
            encoding="utf-8"
        ),
        f"{REMOTE_ROOT}/.dockerignore": (LOCAL_ROOT / ".dockerignore").read_text(encoding="utf-8"),
        f"{REMOTE_ROOT}/.env": env_content,
        f"{REMOTE_ROOT}/DEPLOY_CREDENTIALS.txt": creds,
        "/etc/nginx/conf.d/ljl.050415.xyz.conf": (
            LOCAL_ROOT / "deploy" / "nginx-ljl.050415.xyz.conf"
        ).read_text(encoding="utf-8"),
    }

    with client.open_sftp() as sftp:
        for remote, content in files.items():
            put_text(sftp, remote, content)

    # Stop host pm2 instance if any
    run(
        client,
        'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; '
        "pm2 delete aether 2>/dev/null || true; docker rm -f aether 2>/dev/null || true",
    )

    code, _ = run(client, "set -e; cd /opt/aether; docker compose build 2>&1", timeout=1800)
    if code != 0:
        print("DOCKER_BUILD_FAILED")
        return 1

    code, _ = run(
        client,
        "set -e; cd /opt/aether; docker compose up -d; sleep 4; "
        "docker compose ps; docker logs aether --tail 80",
    )
    if code != 0:
        print("DOCKER_UP_FAILED")
        return 1

    code, _ = run(client, "nginx -t && systemctl reload nginx && echo NGINX_OK")
    if code != 0:
        print("NGINX_FAILED")
        return 1

    run(
        client,
        "curl -sS http://127.0.0.1:8787/api/health; echo; "
        'curl -sk -H "Host: ljl.050415.xyz" https://127.0.0.1/api/health; echo; '
        'curl -sk -o /dev/null -w "spa:%{http_code}\\n" -H "Host: ljl.050415.xyz" https://127.0.0.1/; '
        'curl -sk -o /dev/null -w "auth:%{http_code}\\n" -H "Host: ljl.050415.xyz" https://127.0.0.1/api/home; '
        "docker inspect --format='{{.State.Health.Status}}' aether 2>/dev/null || true",
    )

    print("\n=== DEPLOY SUMMARY ===")
    print("URL: https://ljl.050415.xyz")
    print("SITE_PASSWORD:", site_password)
    print("AUTH_SECRET:", auth_secret)
    print("Credentials file on server: /opt/aether/DEPLOY_CREDENTIALS.txt")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
