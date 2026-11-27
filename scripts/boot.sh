#!/usr/bin/env bash
# Boot script for a hosted instance (Render, Railway, Fly, any Node host).
# Resets to a known demo state on every start, so a cold start always lands on
# the same 130-claim book and the same three demo accounts.

set -euo pipefail

echo "[boot] resetting the demo database"
rm -f prisma/dev.db prisma/dev.db-journal

echo "[boot] applying migrations"
npx prisma migrate deploy

echo "[boot] seeding the demo book"
npx prisma db seed

echo "[boot] starting the server on port ${PORT:-3000}"
exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
