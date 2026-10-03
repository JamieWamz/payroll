-- Run once per Neon project using that project's owner connection string:
--
--   psql "$NEON_OWNER_DATABASE_URL" --set=ON_ERROR_STOP=1 \
--     --set=migration_password="$NEON_MIGRATION_ROLE_PASSWORD" \
--     --set=app_password="$NEON_APP_ROLE_PASSWORD" \
--     --file deploy/neon/bootstrap-roles.sql
--
-- This file deliberately contains no credentials. It expects `psql` variables
-- migration_password and app_password, and configures the exact fixed role
-- names referenced by the versioned application migrations.

SELECT current_database() AS database_name \gset

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
