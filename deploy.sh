#!/bin/bash
PUBLIC_URL=$(python3 -c "
import sqlite3, json
try:
    conn = sqlite3.connect('data/bot.db')
    row = conn.execute(\"SELECT value FROM config WHERE key='public_url'\").fetchone()
    print(json.loads(row[0]) if row else '')
except:
    print('')
" 2>/dev/null)

CLEAN_URL="${PUBLIC_URL#https://}"
CLEAN_URL="${CLEAN_URL#http://}"
CLEAN_URL="${CLEAN_URL%/}"  # strip trailing slash

if [[ -n "$CLEAN_URL" && "$CLEAN_URL" == *.* && "$CLEAN_URL" != *"localhost"* ]]; then

    # Write to .env so docker-compose picks it up automatically
    if grep -q "^PUBLIC_URL=" .env 2>/dev/null; then
        sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$CLEAN_URL|" .env
    else
        echo "PUBLIC_URL=$CLEAN_URL" >> .env
    fi

fi

# Build len ak sa zmenili závislosti alebo Dockerfile
if git diff HEAD~1 HEAD -- pyproject.toml uv.lock Dockerfile 2>/dev/null | grep -q .; then
    echo "Rebuilding image..."
    docker-compose build
fi

docker rm -f $(docker ps -aq) 2>/dev/null || true
docker-compose up -d "$@"
