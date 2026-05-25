-- Setup Certificate-based Authentication on SQLSERVER2
-- Import sqlserver1's certificate and create login

USE master;
GO

-- Create certificate from sqlserver1 file
IF NOT EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver1_cert')
BEGIN
    CREATE CERTIFICATE sqlserver1_cert
    FROM FILE = '/var/opt/mssql/data/sqlserver1_cert.cer';
END
GO

-- Create login for sqlserver1
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'sqlserver1_login')
BEGIN
    CREATE LOGIN sqlserver1_login FROM CERTIFICATE sqlserver1_cert;
END
GO

-- Grant CONNECT ON ENDPOINT permission
GRANT CONNECT ON ENDPOINT::AGEndpoint TO sqlserver1_login;
GO

PRINT 'SQLSERVER2 configured to trust sqlserver1 certificate';
GO
