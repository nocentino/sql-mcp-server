-- Workload script for Always On Availability Group testing
-- Generates read load on ProductsDB to populate wait stats, plan cache, and I/O counters.
-- Run this on the primary replica (sqlserver1) before asking Copilot for a health report.
--
-- Usage:
--   docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd \
--     -S localhost -U sa -P "${SA_PASSWORD}" -C \
--     -d ProductsDB -i scripts/generate-ag-workload.sql

USE ProductsDB;
GO

PRINT 'Generating read workload on ProductsDB...';

DECLARE @i INT = 0;
WHILE @i < 200
BEGIN
    -- Multi-table join — exercises the query plan cache and generates logical reads
    SELECT p.ProductName, p.UnitPrice, p.Category,
           od.Quantity, od.UnitPrice AS OrderPrice,
           o.CustomerName, o.OrderDate, o.Status
    FROM   dbo.Products p
    JOIN   dbo.OrderDetails od ON od.ProductID = p.ProductID
    JOIN   dbo.Orders o        ON o.OrderID    = od.OrderID
    WHERE  p.UnitPrice > RAND() * 500
    ORDER  BY p.Category, p.UnitPrice DESC;

    -- Category summary — tests GROUP BY path
    SELECT Category,
           COUNT(*)        AS ProductCount,
           AVG(UnitPrice)  AS AvgPrice,
           SUM(UnitsInStock) AS TotalStock
    FROM   dbo.Products
    GROUP  BY Category
    ORDER  BY AvgPrice DESC;

    SET @i = @i + 1;
END
GO

PRINT 'Workload complete. Plan cache and wait stats are now populated.';
PRINT 'Ask Copilot: "What are the top 5 most expensive queries on SqlServer1 since the server started?"';
GO
