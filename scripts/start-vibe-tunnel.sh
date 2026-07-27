#!/usr/bin/env bash
set -euo pipefail

local_port="${VIBE_LOCAL_PORT:-18789}"
remote_port="${VIBE_REMOTE_PORT:-8787}"
remote_host="${VIBE_REMOTE_HOST:-127.0.0.1}"
ssh_target="${VIBE_SSH_TARGET:-dev0}"

if [[ ! "${local_port}" =~ ^[0-9]+$ ]] || [[ ! "${remote_port}" =~ ^[0-9]+$ ]]; then
  echo "VIBE_LOCAL_PORT and VIBE_REMOTE_PORT must be numeric." >&2
  exit 2
fi

if (( local_port < 1024 || local_port > 65535 || remote_port < 1 || remote_port > 65535 )); then
  echo "Port is outside the allowed range." >&2
  exit 2
fi

exec ssh \
  -N \
  -T \
  -L "127.0.0.1:${local_port}:${remote_host}:${remote_port}" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o TCPKeepAlive=no \
  "${ssh_target}"

