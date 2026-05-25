-- Workload script for Always On Availability Group testing
-- This script generates load on TestDB and creates blocking scenarios

USE TestDB;
GO

-- Insert a batch of rows to generate some activity
PRINT 'Inserting 1000 rows...';
DECLARE @i INT = 1;
WHILE @i <= 1000
BEGIN
    INSERT INTO TestData (TestValue) 
    VALUES ('Workload Row ' + CAST(@i AS VARCHAR(10)));
    SET @i = @i + 1;
END
GO

PRINT 'Workload generation complete.';
PRINT 'Total rows in TestData: ' + CAST((SELECT COUNT(*) FROM TestData) AS VARCHAR(20));
GO
