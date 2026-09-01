#!/bin/sh

set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${MIGRATION_DB_PASSWORD:?MIGRATION_DB_PASSWORD is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=database_name="$POSTGRES_DB" \
  --set=migration_password="$MIGRATION_DB_PASSWORD" \
  --set=app_password="$APP_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
SELECT format(
  'CREATE ROLE zampayroll_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'migration_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'zampayroll_migrator'
) \gexec

SELECT format(
  'CREATE ROLE zampayroll_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'zampayroll_app'
) \gexec

ALTER ROLE zampayroll_migrator WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE zampayroll_app WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

REVOKE CONNECT ON DATABASE :"database_name" FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE :"database_name" TO zampayroll_migrator;
GRANT CONNECT ON DATABASE :"database_name" TO zampayroll_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

ALTER ROLE zampayroll_migrator IN DATABASE :"database_name"
  SET search_path = app, public;
ALTER ROLE zampayroll_app IN DATABASE :"database_name"
  SET search_path = app;
SQL
