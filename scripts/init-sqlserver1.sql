-- =====================================================================
-- SQL Server MCP Demo - Database Initialization Script
-- =====================================================================
-- This script creates a sample database for demonstrating the
-- Data API Builder MCP Server capabilities
-- =====================================================================

USE master;
GO

-- Create database if it doesn't exist
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'ProductsDB')
BEGIN
    CREATE DATABASE ProductsDB;
    PRINT 'Database ProductsDB created successfully.';
END
ELSE
BEGIN
    PRINT 'Database ProductsDB already exists.';
END
GO

USE ProductsDB;
GO

-- =====================================================================
-- Create Categories Table
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Categories')
BEGIN
    CREATE TABLE dbo.Categories
    (
        CategoryID INT NOT NULL PRIMARY KEY IDENTITY(1,1),
        CategoryName NVARCHAR(50) NOT NULL,
        Description NVARCHAR(500) NULL
    );
    PRINT 'Table Categories created successfully.';
END
GO

-- =====================================================================
-- Create Products Table
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
BEGIN
    CREATE TABLE dbo.Products
    (
        ProductID INT NOT NULL PRIMARY KEY IDENTITY(1,1),
        ProductName NVARCHAR(100) NOT NULL,
        Category NVARCHAR(50) NOT NULL,
        UnitPrice DECIMAL(10,2) NOT NULL,
        UnitsInStock INT NOT NULL,
        Discontinued BIT NOT NULL DEFAULT 0
    );
    PRINT 'Table Products created successfully.';
END
GO

-- =====================================================================
-- Create Orders Table
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
BEGIN
    CREATE TABLE dbo.Orders
    (
        OrderID INT NOT NULL PRIMARY KEY IDENTITY(1,1),
        CustomerName NVARCHAR(100) NOT NULL,
        OrderDate DATETIME NOT NULL DEFAULT GETDATE(),
        TotalAmount DECIMAL(10,2) NOT NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT 'Pending'
            CONSTRAINT CK_Orders_Status CHECK (Status IN ('Pending', 'Shipped', 'Delivered', 'Cancelled'))
    );
    PRINT 'Table Orders created successfully.';
END
GO

-- =====================================================================
-- Create OrderDetails Table
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderDetails')
BEGIN
    CREATE TABLE dbo.OrderDetails
    (
        OrderDetailID INT NOT NULL PRIMARY KEY IDENTITY(1,1),
        OrderID INT NOT NULL,
        ProductID INT NOT NULL,
        Quantity INT NOT NULL,
        UnitPrice DECIMAL(10,2) NOT NULL,
        CONSTRAINT FK_OrderDetails_Orders FOREIGN KEY (OrderID) REFERENCES dbo.Orders(OrderID),
        CONSTRAINT FK_OrderDetails_Products FOREIGN KEY (ProductID) REFERENCES dbo.Products(ProductID)
    );
    PRINT 'Table OrderDetails created successfully.';
END
GO

-- =====================================================================
-- Insert Sample Categories
-- =====================================================================
IF NOT EXISTS (SELECT * FROM dbo.Categories)
BEGIN
    INSERT INTO dbo.Categories (CategoryName, Description) VALUES
    ('Electronics', 'Electronic devices and accessories'),
    ('Furniture', 'Office and home furniture'),
    ('Office Supplies', 'Stationery and office essentials'),
    ('Appliances', 'Home and kitchen appliances');
    PRINT 'Sample categories inserted successfully.';
END
GO

-- =====================================================================
-- Insert Sample Products
-- =====================================================================
IF NOT EXISTS (SELECT * FROM dbo.Products)
BEGIN
    INSERT INTO dbo.Products (ProductName, Category, UnitPrice, UnitsInStock, Discontinued) VALUES
    ('Laptop Pro 15', 'Electronics', 1299.99, 45, 0),
    ('Wireless Mouse', 'Electronics', 29.99, 150, 0),
    ('Office Chair', 'Furniture', 249.99, 30, 0),
    ('Standing Desk', 'Furniture', 599.99, 15, 0),
    ('Coffee Maker', 'Appliances', 89.99, 60, 0),
    ('Notebook Set', 'Office Supplies', 12.99, 200, 0),
    ('USB-C Hub', 'Electronics', 49.99, 80, 0),
    ('Desk Lamp', 'Furniture', 39.99, 100, 0),
    ('Bluetooth Headphones', 'Electronics', 149.99, 50, 0),
    ('Water Bottle', 'Office Supplies', 19.99, 120, 0),
    ('Ergonomic Keyboard', 'Electronics', 79.99, 65, 0),
    ('Monitor Stand', 'Furniture', 34.99, 90, 0),
    ('Pen Set Premium', 'Office Supplies', 24.99, 175, 0),
    ('Air Purifier', 'Appliances', 179.99, 25, 0),
    ('Desk Organizer', 'Office Supplies', 18.99, 140, 0),
    ('Webcam HD', 'Electronics', 69.99, 55, 0),
    ('Bookshelf', 'Furniture', 129.99, 20, 0),
    ('Electric Kettle', 'Appliances', 44.99, 75, 0),
    ('Whiteboard', 'Office Supplies', 59.99, 40, 0),
    ('Laptop Stand', 'Electronics', 39.99, 85, 0);
    PRINT 'Sample products inserted successfully.';
END
GO

-- =====================================================================
-- Insert Sample Orders
-- =====================================================================
IF NOT EXISTS (SELECT * FROM dbo.Orders)
BEGIN
    INSERT INTO dbo.Orders (CustomerName, OrderDate, TotalAmount, Status) VALUES
    ('John Smith', '2024-02-10', 1349.98, 'Delivered'),
    ('Jane Doe', '2024-02-11', 279.97, 'Shipped'),
    ('Bob Johnson', '2024-02-12', 599.99, 'Pending'),
    ('Alice Williams', '2024-02-13', 89.99, 'Delivered'),
    ('Charlie Brown', '2024-02-14', 199.96, 'Shipped');
    PRINT 'Sample orders inserted successfully.';
END
GO

-- =====================================================================
-- Insert Sample Order Details
-- =====================================================================
IF NOT EXISTS (SELECT * FROM dbo.OrderDetails)
BEGIN
    -- Order 1: John Smith
    INSERT INTO dbo.OrderDetails (OrderID, ProductID, Quantity, UnitPrice) VALUES
    (1, 1, 1, 1299.99),  -- Laptop Pro 15
    (1, 2, 2, 29.99);     -- Wireless Mouse x2

    -- Order 2: Jane Doe
    INSERT INTO dbo.OrderDetails (OrderID, ProductID, Quantity, UnitPrice) VALUES
    (2, 3, 1, 249.99),    -- Office Chair
    (2, 2, 1, 29.99);     -- Wireless Mouse

    -- Order 3: Bob Johnson
    INSERT INTO dbo.OrderDetails (OrderID, ProductID, Quantity, UnitPrice) VALUES
    (3, 4, 1, 599.99);    -- Standing Desk

    -- Order 4: Alice Williams
    INSERT INTO dbo.OrderDetails (OrderID, ProductID, Quantity, UnitPrice) VALUES
    (4, 5, 1, 89.99);     -- Coffee Maker

    -- Order 5: Charlie Brown
    INSERT INTO dbo.OrderDetails (OrderID, ProductID, Quantity, UnitPrice) VALUES
    (5, 9, 1, 149.99),    -- Bluetooth Headphones
    (5, 6, 4, 12.99);     -- Notebook Set x4
    
    PRINT 'Sample order details inserted successfully.';
END
GO

-- =====================================================================
-- Create Helpful Views
-- =====================================================================

-- View: Product Inventory Report
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_ProductInventory')
    DROP VIEW dbo.vw_ProductInventory;
GO

CREATE VIEW dbo.vw_ProductInventory AS
SELECT 
    ProductID,
    ProductName,
    Category,
    UnitPrice,
    UnitsInStock,
    UnitPrice * UnitsInStock AS InventoryValue,
    CASE 
        WHEN UnitsInStock = 0 THEN 'Out of Stock'
        WHEN UnitsInStock < 50 THEN 'Low Stock'
        ELSE 'In Stock'
    END AS StockStatus,
    Discontinued
FROM dbo.Products;
GO

-- View: Order Summary
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_OrderSummary')
    DROP VIEW dbo.vw_OrderSummary;
GO

CREATE VIEW dbo.vw_OrderSummary AS
SELECT 
    o.OrderID,
    o.CustomerName,
    o.OrderDate,
    o.Status,
    COUNT(od.OrderDetailID) AS ItemCount,
    SUM(od.Quantity) AS TotalUnits,
    o.TotalAmount
FROM dbo.Orders o
LEFT JOIN dbo.OrderDetails od ON o.OrderID = od.OrderID
GROUP BY o.OrderID, o.CustomerName, o.OrderDate, o.Status, o.TotalAmount;
GO

-- =====================================================================
-- Create Stored Procedures
-- =====================================================================

-- Procedure: Get Products by Category
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetProductsByCategory')
    DROP PROCEDURE dbo.sp_GetProductsByCategory;
GO

CREATE PROCEDURE dbo.sp_GetProductsByCategory
    @Category NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        ProductID,
        ProductName,
        Category,
        UnitPrice,
        UnitsInStock,
        Discontinued
    FROM dbo.Products
    WHERE Category = @Category
    ORDER BY ProductName;
END
GO

-- Procedure: Get Low Stock Products
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_GetLowStockProducts')
    DROP PROCEDURE dbo.sp_GetLowStockProducts;
GO

CREATE PROCEDURE dbo.sp_GetLowStockProducts
    @Threshold INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        ProductID,
        ProductName,
        Category,
        UnitPrice,
        UnitsInStock
    FROM dbo.Products
    WHERE UnitsInStock < @Threshold 
    AND Discontinued = 0
    ORDER BY UnitsInStock ASC;
END
GO

-- =====================================================================
-- Display Summary Information
-- =====================================================================
PRINT '';
PRINT '=====================================================================';
PRINT 'Database initialization completed successfully!';
PRINT '=====================================================================';
PRINT '';

SELECT 
    'Products' AS TableName,
    COUNT(*) AS RecordCount
FROM dbo.Products
UNION ALL
SELECT 
    'Categories' AS TableName,
    COUNT(*) AS RecordCount
FROM dbo.Categories
UNION ALL
SELECT 
    'Orders' AS TableName,
    COUNT(*) AS RecordCount
FROM dbo.Orders
UNION ALL
SELECT 
    'OrderDetails' AS TableName,
    COUNT(*) AS RecordCount
FROM dbo.OrderDetails;
GO

PRINT '';
PRINT 'Database is ready for Data API Builder MCP Server!';
PRINT 'Connection String: Server=sqlserver,1433;Database=ProductsDB;User ID=sa;Password=<your-password>';
PRINT '';
GO

-- =====================================================================
-- DBA monitoring login
-- The SQL MCP server connects as this account.  The only requirement
-- for real SQL Servers is: GRANT VIEW SERVER STATE TO <login>.
-- No views, stored procedures, or schema changes are needed.
-- =====================================================================
USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'dba_monitor')
BEGIN
    CREATE LOGIN dba_monitor WITH PASSWORD = 'MonitorP@ss123!',
        CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
    PRINT 'Login dba_monitor created.';
END
ELSE
    PRINT 'Login dba_monitor already exists.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'dba_monitor')
    CREATE USER dba_monitor FOR LOGIN dba_monitor;
GO

-- Server-level permissions for DMVs and cross-database monitoring
GRANT VIEW SERVER STATE   TO dba_monitor;
GRANT VIEW DATABASE STATE TO dba_monitor;
GRANT VIEW ANY DATABASE   TO dba_monitor;  -- Required for sys.master_files and cross-DB queries
GRANT VIEW ANY DEFINITION TO dba_monitor;  -- Required for sys.databases, sys.indexes, etc.
GO

-- Grant dba_monitor access to ProductsDB for per-database tools
-- (statistics health, index fragmentation, query store regressions)
USE [ProductsDB];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'dba_monitor')
    CREATE USER dba_monitor FOR LOGIN dba_monitor;
GO
GRANT VIEW DATABASE STATE TO dba_monitor;
GRANT VIEW DEFINITION     TO dba_monitor;
GRANT SELECT ON SCHEMA::dbo TO dba_monitor;
GO

-- Grant dba_monitor access to msdb for SQL Agent job status queries
USE [msdb];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'dba_monitor')
    CREATE USER dba_monitor FOR LOGIN dba_monitor;
GO
EXEC sp_addrolemember 'SQLAgentReaderRole', 'dba_monitor';
GRANT SELECT ON dbo.sysjobactivity  TO dba_monitor;
GRANT SELECT ON dbo.sysjobs         TO dba_monitor;
GRANT SELECT ON dbo.sysjobhistory   TO dba_monitor;
GRANT SELECT ON dbo.sysjobsteps     TO dba_monitor;
GRANT SELECT ON dbo.sysjobservers   TO dba_monitor;
GRANT SELECT ON dbo.sysschedules    TO dba_monitor;
GRANT SELECT ON dbo.sysjobschedules TO dba_monitor;
GO

USE [master];
GO

PRINT 'dba_monitor account ready (VIEW SERVER STATE + VIEW ANY DATABASE + VIEW ANY DEFINITION + ProductsDB + msdb granted).';

-- =====================================================================
-- DAB application login
-- Data API Builder connects as this account for REST/GraphQL CRUD.
-- Only SELECT/INSERT/UPDATE/DELETE on the four ProductsDB tables —
-- no server-level permissions, no access to system views.
-- =====================================================================
USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'dab_app')
BEGIN
    CREATE LOGIN dab_app WITH PASSWORD = 'DabP@ss123!',
        CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
    PRINT 'Login dab_app created.';
END
ELSE
    PRINT 'Login dab_app already exists.';
GO

USE [ProductsDB];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'dab_app')
    CREATE USER dab_app FOR LOGIN dab_app;
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Products     TO dab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Categories   TO dab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Orders       TO dab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.OrderDetails TO dab_app;
GO

USE master;
GO

PRINT 'dab_app account ready (SELECT/INSERT/UPDATE/DELETE on ProductsDB application tables granted).';
