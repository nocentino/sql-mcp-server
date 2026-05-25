-- Create and seed test database on SQLSERVER1

-- Create database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'TestDB')
BEGIN
    CREATE DATABASE TestDB;
END
GO

USE TestDB;
GO

-- Create a test table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
BEGIN
    CREATE TABLE Orders (
        OrderID INT PRIMARY KEY IDENTITY(1,1),
        CustomerName NVARCHAR(100),
        OrderDate DATETIME DEFAULT GETDATE(),
        TotalAmount DECIMAL(10,2),
        Status NVARCHAR(20)
    );
END
GO

-- Seed with sample data
INSERT INTO Orders (CustomerName, OrderDate, TotalAmount, Status)
VALUES 
    ('Acme Corp', '2025-01-15', 1250.00, 'Completed'),
    ('TechStart Inc', '2025-01-16', 3400.50, 'Pending'),
    ('Global Supplies', '2025-01-17', 875.25, 'Shipped'),
    ('DataSoft LLC', '2025-01-18', 2100.00, 'Completed'),
    ('Cloud Systems', '2025-01-19', 5600.75, 'Processing');
GO

-- Set database to full recovery model (required for AG)
ALTER DATABASE TestDB SET RECOVERY FULL;
GO

-- Take a full backup (required before adding to AG)
BACKUP DATABASE TestDB 
TO DISK = '/var/opt/mssql/data/TestDB.bak'
WITH FORMAT, INIT, COMPRESSION;
GO

PRINT 'TestDB created, seeded, and backed up';
GO

-- Verify data
SELECT COUNT(*) AS OrderCount FROM TestDB.dbo.Orders;
GO
