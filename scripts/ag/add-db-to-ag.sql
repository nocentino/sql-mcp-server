-- Add TestDB to the Availability Group on SQLSERVER1 (Primary)

USE master;
GO

-- Add the database to the availability group
ALTER AVAILABILITY GROUP TestAG ADD DATABASE TestDB;
GO

PRINT 'TestDB added to TestAG on primary replica';
GO

-- Check AG database status
SELECT 
    ag.name AS AGName,
    db.database_name AS DatabaseName,
    db.synchronization_state_desc AS SyncState,
    db.synchronization_health_desc AS SyncHealth
FROM sys.dm_hadr_availability_group_states ags
JOIN sys.availability_groups ag ON ags.group_id = ag.group_id
JOIN sys.dm_hadr_database_replica_states db ON ag.group_id = db.group_id
ORDER BY ag.name, db.database_name;
GO
