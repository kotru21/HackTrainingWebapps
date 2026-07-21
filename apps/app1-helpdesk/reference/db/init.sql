-- Reference DB init: least-privilege app role (V1.7 fix)
CREATE USER helpdesk_admin WITH PASSWORD 'change-me-admin';
CREATE DATABASE helpdesk OWNER helpdesk_admin;

\c helpdesk

CREATE USER helpdesk_app WITH PASSWORD 'helpdesk_app_secret';
GRANT CONNECT ON DATABASE helpdesk TO helpdesk_app;
GRANT USAGE ON SCHEMA public TO helpdesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helpdesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helpdesk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helpdesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO helpdesk_app;
