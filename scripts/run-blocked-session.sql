-- Blocked session script - run AFTER starting the blocker
-- This script will be blocked until the blocking transaction completes

USE TestDB;
GO

PRINT 'Attempting to update same row (will be blocked)...';
PRINT 'Session ID: ' + CAST(@@SPID AS VARCHAR(10));

-- This will be blocked by the blocker transaction
UPDATE TestData 
SET TestValue = 'Updated by blocked session ' + CAST(@@SPID AS VARCHAR(10))
WHERE ID = 1;

PRINT 'Update complete (blocking released).';
GO
