-- Setup Always On Availability Group with Certificate Authentication
-- This script configures a cluster-less AG between two SQL Server instances

-- =============================================
-- Step 1: Create Master Keys and Certificates on SQLSERVER1 (Primary)
-- =============================================
USE master;
GO

-- Create master key if it doesn't exist
IF NOT EXISTS (SELECT * FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
BEGIN
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'S0methingS@Str0ng!AG';
END
GO

-- Create certificate for sqlserver1
IF NOT EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver1_cert')
BEGIN
    CREATE CERTIFICATE sqlserver1_cert
    WITH SUBJECT = 'Certificate for sqlserver1 AG endpoint',
    EXPIRY_DATE = '2030-12-31';
END
GO

-- Backup the certificate (need to copy to shared location)
BACKUP CERTIFICATE sqlserver1_cert 
TO FILE = '/var/opt/mssql/data/sqlserver1_cert.cer';
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
        AUTHENTICATION = CERTIFICATE sqlserver1_cert,
        ROLE = ALL
    );
END
GO

PRINT 'SQLSERVER1 certificate and endpoint created';
GO
