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

if [[ -n "$PUBLIC_URL" && "$PUBLIC_URL" != *"localhost"* ]]; then
    PUBLIC_URL="$PUBLIC_URL" COMPOSE_PROFILES=production docker-compose up -d "$@"
else
    docker-compose up -d "$@"
fi
