#!/usr/bin/env bash
# Chạy toàn bộ migration + test pgTAP trên Postgres local (không cần Supabase).
set -euo pipefail
DB=${DB:-namchi_test}
cd "$(dirname "$0")/../.."
psql_() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB $*"; }
su postgres -c "dropdb --if-exists $DB" && su postgres -c "createdb $DB"
psql_ "-f scripts/local/supabase_stub.sql"
for f in supabase/migrations/*.sql; do echo "== migration $f"; psql_ "-f $f"; done
psql_ "-c 'create extension if not exists pgtap'"
for t in supabase/tests/*.sql; do echo "== test $t"; su postgres -c "psql -d $DB -X -q -At -v ON_ERROR_STOP=1 -f $t"; done
