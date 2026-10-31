-- Disalin dari BSD §3 blok 1. Dijalankan sekali oleh infra/db-vm/bin/db-init.sh sebagai superuser.
-- Dijalankan sekali oleh superuser container (runbook M0b), bukan oleh dbmate.
-- Password diisi lewat \password dari secret file, tidak pernah ditulis di repo.
create role dompetku_owner   login    nosuperuser nocreatedb nocreaterole bypassrls;
create role dompetku_api     nologin  nosuperuser nobypassrls;
create role dompetku_web     login    nosuperuser nobypassrls;
create role dompetku_worker  login    nosuperuser nobypassrls;
create role dompetku_auditor nologin  nosuperuser bypassrls;
create role dompetku_monitor login    nosuperuser nobypassrls in role pg_monitor;

-- owner harus bisa SET ROLE ke api/auditor agar bisa ALTER ... OWNER TO.
grant dompetku_api, dompetku_auditor to dompetku_owner;

create database dompetku owner dompetku_owner;
revoke all on database dompetku from public;
grant connect on database dompetku to dompetku_web, dompetku_worker, dompetku_monitor;
alter database dompetku set timezone = 'UTC';

-- Timeout per role (angka dari round2/backend-engineer §2.4). Worker 60 s untuk purge dan dq_run
-- pada data besar; diukur di job CI kinerja.
alter role dompetku_web    set statement_timeout = '5s';
alter role dompetku_web    set lock_timeout = '3s';
alter role dompetku_web    set idle_in_transaction_session_timeout = '15s';
alter role dompetku_worker set statement_timeout = '60s';
alter role dompetku_worker set lock_timeout = '3s';
alter role dompetku_worker set idle_in_transaction_session_timeout = '15s';

-- Isolasi wajib READ COMMITTED (lihat atas); fungsi tulis juga memeriksanya.
alter role dompetku_web    set default_transaction_isolation = 'read committed';
alter role dompetku_worker set default_transaction_isolation = 'read committed';

-- BSD §12: role audit objek pgaudit (hak per tabel diberikan migrasi yang membuat tabelnya).
create role dompetku_auditlog nologin;
