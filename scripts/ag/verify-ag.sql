-- Verify Always On Availability Group Status

USE master;
GO

PRINT '=== Availability Group Configuration ===';
SELECT 
    ag.name AS AGName,
    ag.cluster_type_desc AS ClusterType,
    ar.replica_server_name AS ReplicaName,
    ar.availability_mode_desc AS AvailabilityMode,
    ar.failover_mode_desc AS FailoverMode,
    ar.endpoint_url AS EndpointURL,
    rs.role_desc AS CurrentRole,
    rs.operational_state_desc AS OperationalState,
    rs.connected_state_desc AS ConnectedState
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
LEFT JOIN sys.dm_hadr_availability_replica_states rs ON ar.replica_id = rs.replica_id
ORDER BY ar.replica_server_name;
GO

PRINT '';
PRINT '=== Database Synchronization Status ===';
SELECT 
    ag.name AS AGName,
    drs.database_id AS DatabaseID,
    db.name AS DatabaseName,
    ar.replica_server_name AS ReplicaName,
    drs.synchronization_state_desc AS SyncState,
    drs.synchronization_health_desc AS SyncHealth,
    drs.is_suspended AS IsSuspended,
    drs.log_send_queue_size AS LogSendQueueKB,
    drs.redo_queue_size AS RedoQueueKB
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_groups ag ON drs.group_id = ag.group_id
JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id
JOIN sys.databases db ON drs.database_id = db.database_id
ORDER BY ag.name, db.name, ar.replica_server_name;
GO

PRINT '';
PRINT '=== Endpoint Status ===';
SELECT 
    name AS EndpointName,
    type_desc AS EndpointType,
    state_desc AS State,
    port AS Port
FROM sys.tcp_endpoints
WHERE type_desc = 'DATABASE_MIRRORING';
GO
