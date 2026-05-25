-- =====================================================================
-- SqlServer2 — DBA monitoring login
-- Mirrors the dba_monitor account on SqlServer1.
-- Server-level DMV permissions only; no application database here.
-- =====================================================================

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'dba_monitor')
BEGIN
    CREATE LOGIN dba_monitor WITH PASSWORD = 'MonitorP@ss123!',
        CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
    PRINT 'Login dba_monitor created.';
END
ELSE
    PRINT 'Login dba_monitor already exists.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'dba_monitor')
    CREATE USER dba_monitor FOR LOGIN dba_monitor;
GO

GRANT VIEW SERVER STATE   TO dba_monitor;
GRANT VIEW DATABASE STATE TO dba_monitor;
GRANT VIEW ANY DATABASE   TO dba_monitor;
GRANT VIEW ANY DEFINITION TO dba_monitor;
GO

PRINT 'dba_monitor account ready on sqlserver2.';
GO
