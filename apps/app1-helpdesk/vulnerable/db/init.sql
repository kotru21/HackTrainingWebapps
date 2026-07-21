-- Vulnerable DB init: app connects as superuser (V1.7)
CREATE USER helpdesk WITH SUPERUSER PASSWORD 'helpdesk';
CREATE DATABASE helpdesk OWNER helpdesk;
