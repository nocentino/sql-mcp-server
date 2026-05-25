-- Setup Always On Availability Group - SQLSERVER2 (Secondary)
-- This script configures the secondary replica

-- =============================================
-- Step 1: Create Master Key on SQLSERVER2
-- =============================================
USE master;
GO

-- Create master key if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
BEGIN
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'S0methingS@Str0ng!AG';
END
GO

-- Create certificate for sqlserver2
IF NOT EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver2_cert')
BEGIN
    CREATE CERTIFICATE sqlserver2_cert
    WITH SUBJECT = 'Certificate for sqlserver2 AG endpoint',
    EXPIRY_DATE = '2030-12-31';
END
GO

-- Backup the certificate
BACKUP CERTIFICATE sqlserver2_cert 
TO FILE = '/var/opt/mssql/data/sqlserver2_cert.cer';
GO

-- Create endpoint for database mirroring using certificate
IF NOT EXISTS (SELECT * FROM sys.endpoints WHERE name = 'AGEndpoint')
BEGIN
    CREATE ENDPOINT AGEndpoint
    STATE = STARTED
    AS TCP (
        LISTENER_PORT = 5022,
        LISTENER_IP = ALL
    )
    FOR DATABASE_MIRRORING (
        AUTHENTICATION = CERTIFICATE sqlserver2_cert,
        ROLE = ALL
    );
END
GO

PRINT 'SQLSERVER2 certificate and endpoint created';
GO
