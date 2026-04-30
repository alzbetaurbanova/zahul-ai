#!/bin/bash
set -euo pipefail

DEPLOY_DIR=/home/ubuntu/zahul-ai
LOG=/home/ubuntu/deploy.log

exec >> "$LOG" 2>&1
echo "=== Deploy started: $(date) ==="

cd "$DEPLOY_DIR"

# Čítaj public_url z DB — ak reálna doména, spusti aj Caddy
PUBLIC_URL=$(python3 -c "
import sqlite3, json
try:
    conn = sqlite3.connect('data/bot.db')
    row = conn.execute(\"SELECT value FROM config WHERE key='public_url'\").fetchone()
    print(json.loads(row[0]) if row else '')
except:
    print('')
" 2>/dev/null)

if [[ -n "$PUBLIC_URL" && "$PUBLIC_URL" != *"localhost"* ]]; then
    export PUBLIC_URL COMPOSE_PROFILES=production
fi
DC="docker-compose"

# 1) Záloha aktuálneho image pred akoukoľvek zmenou
PREV_SHA=$(git rev-parse --short HEAD)
RUNNING_IMAGE=$(docker inspect zahul_ai --format='{{.Image}}' 2>/dev/null || echo "")
if [ -n "$RUNNING_IMAGE" ]; then
    docker tag "$RUNNING_IMAGE" zahul-rollback:latest 2>/dev/null || true
fi

# 2) Pull nového kódu
if ! { git fetch origin && git reset --hard origin/master; }; then
    echo "ERROR: git fetch/reset failed, aborting."
    exit 1
fi

NEW_SHA=$(git rev-parse --short HEAD)
if [ "$PREV_SHA" = "$NEW_SHA" ]; then
    echo "No changes since $PREV_SHA, skipping."
    exit 0
fi

echo "Deploying $PREV_SHA -> $NEW_SHA"

# 3) Build nového image — odstráň starý tag kvôli docker-compose 1.29.2 bugu (AlreadyExists)
docker rmi zahul-ai_zahul:latest 2>/dev/null || true
if ! $DC build; then
    echo "BUILD FAILED — reverting git, production untouched."
    git reset --hard "$PREV_SHA"
    exit 1
fi

# 4) Atomický swap (krátky výpadok ~2s, nutné kvôli docker-compose 1.29.2 ContainerConfig bugu)
docker rm -f $(docker ps -aq) 2>/dev/null || true
$DC up -d

# 5) Health check — max 15s
HEALTHY=false
for i in 1 2 3; do
    sleep 5
    if docker ps --filter "name=zahul_ai" --filter "status=running" | grep -q zahul_ai; then
        HEALTHY=true
        break
    fi
done

if $HEALTHY; then
    echo "Deploy OK: $NEW_SHA"
    docker rmi zahul-rollback:latest 2>/dev/null || true
else
    echo "HEALTH CHECK FAILED — rolling back to $PREV_SHA"
    docker rm -f $(docker ps -aq) 2>/dev/null || true

    if [ -n "$RUNNING_IMAGE" ]; then
        docker tag zahul-rollback:latest zahul-ai_zahul:latest 2>/dev/null || true
    fi

    git reset --hard "$PREV_SHA"
    $DC up -d
    echo "Rollback complete: back on $PREV_SHA"
    exit 1
fi
