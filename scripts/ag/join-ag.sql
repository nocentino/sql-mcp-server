-- Join SQLSERVER2 to the Availability Group

USE master;
GO

-- Join this replica to the availability group
ALTER AVAILABILITY GROUP TestAG JOIN;
GO

-- Join the database to the availability group
ALTER DATABASE TestDB SET HADR AVAILABILITY GROUP = TestAG;
GO

PRINT 'sqlserver2 joined to TestAG and database added';
GO
