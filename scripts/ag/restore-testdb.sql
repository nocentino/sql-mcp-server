-- Restore TestDB on SQLSERVER2 with NORECOVERY

USE master;
GO

-- Restore the database with NORECOVERY
RESTORE DATABASE TestDB 
FROM DISK = '/var/opt/mssql/data/TestDB.bak'
WITH NORECOVERY, REPLACE;
GO

PRINT 'TestDB restored on sqlserver2 with NORECOVERY';
GO
