-- Creates the exporter role on fresh databases and updates its password on later starts.
\getenv exporter_password POSTGRES_EXPORTER_PASSWORD
BEGIN;
SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'monitoring') AS monitoring_user_exists \gset
SELECT 'CREATE ROLE monitoring LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'monitoring') \gexec
ALTER ROLE monitoring PASSWORD :'exporter_password';
GRANT pg_monitor TO monitoring;
GRANT CONNECT ON DATABASE expense_tracker TO monitoring;
COMMIT;
\if :monitoring_user_exists
  \echo 'Monitoring user already exists; password and permissions updated.'
\else
  \echo 'Monitoring user created; password and permissions configured.'
\endif
