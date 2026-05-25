-- Generate heavy insert workload on TestDB
USE TestDB;
GO

DECLARE @counter INT = 0;
DECLARE @batch_size INT = 1000;
DECLARE @total_batches INT = 50;

PRINT 'Starting insert workload...';

WHILE @counter < @total_batches
BEGIN
    INSERT INTO Orders (CustomerName, OrderDate, TotalAmount, Status)
    SELECT TOP (@batch_size)
        'Customer_' + CAST(ABS(CHECKSUM(NEWID())) % 10000 AS VARCHAR(10)),
        DATEADD(DAY, -ABS(CHECKSUM(NEWID())) % 365, GETDATE()),
        CAST((ABS(CHECKSUM(NEWID())) % 10000) + 100 AS DECIMAL(10,2)),
        CASE ABS(CHECKSUM(NEWID())) % 5
            WHEN 0 THEN 'Pending'
            WHEN 1 THEN 'Processing'
            WHEN 2 THEN 'Shipped'
            WHEN 3 THEN 'Delivered'
            ELSE 'Completed'
        END
    FROM sys.objects o1
    CROSS JOIN sys.objects o2;
    
    SET @counter = @counter + 1;
    
    IF @counter % 10 = 0
    BEGIN
        PRINT CONCAT('Inserted batch ', @counter, ' of ', @total_batches);
    END
END

PRINT CONCAT('Workload complete. Total inserts: ', @counter * @batch_size);
GO

SELECT COUNT(*) AS TotalOrders FROM Orders;
GO
