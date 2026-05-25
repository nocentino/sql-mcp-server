-- Setup Certificate-based Authentication on SQLSERVER1
-- Import sqlserver2's certificate and create login

USE master;
GO

-- Create certificate from sqlserver2 file
IF NOT EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver2_cert')
BEGIN
    CREATE CERTIFICATE sqlserver2_cert
    FROM FILE = '/var/opt/mssql/data/sqlserver2_cert.cer';
END
GO

-- Create login for sqlserver2
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'sqlserver2_login')
BEGIN
    CREATE LOGIN sqlserver2_login FROM CERTIFICATE sqlserver2_cert;
END
GO

-- Grant CONNECT ON ENDPOINT permission
GRANT CONNECT ON ENDPOINT::AGEndpoint TO sqlserver2_login;
GO

PRINT 'SQLSERVER1 configured to trust sqlserver2 certificate';
GO
