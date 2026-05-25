-- Create Availability Group on SQLSERVER1 (Primary)

USE master;
GO

-- Create the availability group
IF NOT EXISTS (SELECT * FROM sys.availability_groups WHERE name = 'TestAG')
BEGIN
    CREATE AVAILABILITY GROUP TestAG
    WITH (
        AUTOMATED_BACKUP_PREFERENCE = PRIMARY,
        DB_FAILOVER = OFF,
        DTC_SUPPORT = NONE,
        CLUSTER_TYPE = NONE
    )
    FOR REPLICA ON 
        N'sqlserver' WITH (
            ENDPOINT_URL = N'TCP://sqlserver:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            SEEDING_MODE = MANUAL,
            FAILOVER_MODE = MANUAL,
            SESSION_TIMEOUT = 10,
            PRIMARY_ROLE (ALLOW_CONNECTIONS = ALL),
            SECONDARY_ROLE (ALLOW_CONNECTIONS = ALL)
        ),
        N'sqlserver2' WITH (
            ENDPOINT_URL = N'TCP://sqlserver2:5022',
            AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
            SEEDING_MODE = MANUAL,
            FAILOVER_MODE = MANUAL,
            SESSION_TIMEOUT = 10,
            PRIMARY_ROLE (ALLOW_CONNECTIONS = ALL),
            SECONDARY_ROLE (ALLOW_CONNECTIONS = ALL)
        );
END
GO

PRINT 'Availability Group TestAG created on sqlserver';
GO

-- Query AG status
SELECT 
    ag.name AS AGName,
    ar.replica_server_name AS ReplicaName,
    ar.availability_mode_desc AS AvailabilityMode,
    ar.failover_mode_desc AS FailoverMode,
    ar.endpoint_url AS EndpointURL
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
ORDER BY ar.replica_server_name;
GO
