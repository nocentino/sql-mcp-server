-- Blocking scenario script for Always On Availability Group testing
-- This script creates intentional blocking to demonstrate monitoring capabilities
-- 
-- Run this script to START the blocker (it will hold locks for 60 seconds)

USE TestDB;
GO

PRINT 'Starting blocking transaction...';
PRINT 'This will hold locks for 60 seconds to demonstrate blocking detection.';

BEGIN TRANSACTION;

-- Update a row to acquire exclusive locks
UPDATE TestData 
SET TestValue = 'BLOCKED - Session ' + CAST(@@SPID AS VARCHAR(10))
WHERE ID = 1;

-- Hold the transaction open for 60 seconds
WAITFOR DELAY '00:01:00';

COMMIT TRANSACTION;

PRINT 'Blocking transaction complete.';
GO
