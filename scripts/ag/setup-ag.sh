#!/bin/bash
# ============================================================================
# Always On Availability Group Setup Script
# ============================================================================
# This script configures a cluster-less Always On AG between two SQL Server
# instances with certificate-based authentication.
#
# Prerequisites:
#   - Both SQL servers must be running with MSSQL_ENABLE_HADR=1
#   - Shared volume 'ag-certs' mounted at /var/opt/ag-certs on both instances
#
# Usage:
#   ./scripts/ag/setup-ag.sh
#
# What it does:
#   1. Creates certificates on both instances
#   2. Establishes mutual trust between instances
#   3. Creates database mirroring endpoints
#   4. Creates TestAG availability group (SYNCHRONOUS_COMMIT)
#   5. Creates and seeds TestDB with sample data
#   6. Adds TestDB to the availability group
#   7. Verifies synchronization status
# ============================================================================

set -e  # Exit on any error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SA_PASSWORD="${SA_PASSWORD:-S0methingS@Str0ng!}"
PRIMARY_CONTAINER="sql-mcp-sqlserver1"
SECONDARY_CONTAINER="sql-mcp-sqlserver2"
AG_NAME="TestAG"
DB_NAME="TestDB"

# Helper function to execute SQL on a container
execute_sql() {
    local container=$1
    local sql=$2
    local server=${3:-localhost}
    
    docker exec "$container" /opt/mssql-tools18/bin/sqlcmd \
        -S "$server" -U sa -P "$SA_PASSWORD" -C -Q "$sql" -h -1 2>&1 | grep -v "^$" || true
}

# Helper function to execute SQL file on a container
execute_sql_file() {
    local container=$1
    local sql_file=$2
    
    docker exec "$container" /opt/mssql-tools18/bin/sqlcmd \
        -S localhost -U sa -P "$SA_PASSWORD" -C -i "$sql_file"
}

# Helper function for progress messages
log_step() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ============================================================================
# STEP 1: Verify Prerequisites
# ============================================================================
log_step "Verifying prerequisites..."

if ! docker ps --format '{{.Names}}' | grep -q "^${PRIMARY_CONTAINER}$"; then
    log_error "Primary container ${PRIMARY_CONTAINER} is not running"
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${SECONDARY_CONTAINER}$"; then
    log_error "Secondary container ${SECONDARY_CONTAINER} is not running"
    exit 1
fi

# Check HADR is enabled on both instances
PRIMARY_HADR=$(execute_sql "$PRIMARY_CONTAINER" "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('IsHadrEnabled') AS INT)")
SECONDARY_HADR=$(execute_sql "$SECONDARY_CONTAINER" "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('IsHadrEnabled') AS INT)")

if [[ "$PRIMARY_HADR" != *"1"* ]]; then
    log_error "HADR is not enabled on primary instance"
    exit 1
fi

if [[ "$SECONDARY_HADR" != *"1"* ]]; then
    log_error "HADR is not enabled on secondary instance"
    exit 1
fi

log_info "Both SQL Server instances are running with HADR enabled"

# ============================================================================
# STEP 1.5: Fix ag-certs Volume Permissions
# ============================================================================
log_step "Setting up certificate directory permissions..."

# Fix permissions on both instances so mssql user can write certificates
docker exec --user root "$PRIMARY_CONTAINER" bash -c "mkdir -p /var/opt/ag-certs && chown mssql:root /var/opt/ag-certs && chmod 777 /var/opt/ag-certs"
docker exec --user root "$SECONDARY_CONTAINER" bash -c "mkdir -p /var/opt/ag-certs && chown mssql:root /var/opt/ag-certs && chmod 777 /var/opt/ag-certs"

log_info "Certificate directory permissions configured"

# ============================================================================
# STEP 2: Create Master Key and Certificates on Primary
# ============================================================================
log_step "Creating master key and certificate on primary..."

execute_sql "$PRIMARY_CONTAINER" "
USE master;
IF NOT EXISTS (SELECT * FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'StrongPassword123!';

-- Drop endpoint first if it exists (endpoints lock certificates)
IF EXISTS (SELECT * FROM sys.endpoints WHERE name = 'Hadr_endpoint')
    DROP ENDPOINT Hadr_endpoint;

IF EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver1_cert')
    DROP CERTIFICATE sqlserver1_cert;

CREATE CERTIFICATE sqlserver1_cert
WITH SUBJECT = 'Certificate for sqlserver1 endpoint';

BACKUP CERTIFICATE sqlserver1_cert 
TO FILE = '/var/opt/ag-certs/sqlserver1_cert.cer'
WITH PRIVATE KEY (
    FILE = '/var/opt/ag-certs/sqlserver1_cert.pvk',
    ENCRYPTION BY PASSWORD = 'CertPassword123!'
);
"

log_info "Primary certificate created and exported to shared volume"

# ============================================================================
# STEP 3: Create Master Key and Certificates on Secondary
# ============================================================================
log_step "Creating master key and certificate on secondary..."

execute_sql "$SECONDARY_CONTAINER" "
USE master;
IF NOT EXISTS (SELECT * FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'StrongPassword123!';

-- Drop AG and endpoint first (they may lock certificates from previous runs)
IF EXISTS (SELECT * FROM sys.availability_groups WHERE name = '${AG_NAME}')
    DROP AVAILABILITY GROUP ${AG_NAME};

IF EXISTS (SELECT * FROM sys.endpoints WHERE name = 'Hadr_endpoint')
    DROP ENDPOINT Hadr_endpoint;

IF EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver2_cert')
    DROP CERTIFICATE sqlserver2_cert;

CREATE CERTIFICATE sqlserver2_cert
WITH SUBJECT = 'Certificate for sqlserver2 endpoint';

BACKUP CERTIFICATE sqlserver2_cert 
TO FILE = '/var/opt/ag-certs/sqlserver2_cert.cer'
WITH PRIVATE KEY (
    FILE = '/var/opt/ag-certs/sqlserver2_cert.pvk',
    ENCRYPTION BY PASSWORD = 'CertPassword123!'
);
"

log_info "Secondary certificate created and exported to shared volume"

# ============================================================================
# STEP 4: Establish Trust - Import Certificates
# ============================================================================
log_step "Establishing mutual trust between instances..."

# Wait a moment for file system sync
sleep 2

# Import secondary's cert on primary
execute_sql "$PRIMARY_CONTAINER" "
USE master;
IF EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver2_cert')
    DROP CERTIFICATE sqlserver2_cert;

CREATE CERTIFICATE sqlserver2_cert
FROM FILE = '/var/opt/ag-certs/sqlserver2_cert.cer';
"

log_info "Imported sqlserver2 certificate on primary"

# Import primary's cert on secondary
execute_sql "$SECONDARY_CONTAINER" "
USE master;
IF EXISTS (SELECT * FROM sys.certificates WHERE name = 'sqlserver1_cert')
    DROP CERTIFICATE sqlserver1_cert;

CREATE CERTIFICATE sqlserver1_cert
FROM FILE = '/var/opt/ag-certs/sqlserver1_cert.cer';
"

log_info "Imported sqlserver1 certificate on secondary"

# ============================================================================
# STEP 5: Create Database Mirroring Endpoints
# ============================================================================
log_step "Creating database mirroring endpoints..."

# Primary endpoint
execute_sql "$PRIMARY_CONTAINER" "
USE master;
IF EXISTS (SELECT * FROM sys.endpoints WHERE name = 'Hadr_endpoint')
    DROP ENDPOINT Hadr_endpoint;

CREATE ENDPOINT Hadr_endpoint
    STATE = STARTED
    AS TCP (LISTENER_PORT = 5022)
    FOR DATABASE_MIRRORING (
        AUTHENTICATION = CERTIFICATE sqlserver1_cert,
        ROLE = ALL
    );
"

log_info "Primary endpoint created on port 5022"

# Secondary endpoint
execute_sql "$SECONDARY_CONTAINER" "
USE master;
IF EXISTS (SELECT * FROM sys.endpoints WHERE name = 'Hadr_endpoint')
    DROP ENDPOINT Hadr_endpoint;

CREATE ENDPOINT Hadr_endpoint
    STATE = STARTED
    AS TCP (LISTENER_PORT = 5022)
    FOR DATABASE_MIRRORING (
        AUTHENTICATION = CERTIFICATE sqlserver2_cert,
        ROLE = ALL
    );
"

log_info "Secondary endpoint created on port 5022"

# ============================================================================
# STEP 6: Create Availability Group on Primary
# ============================================================================
log_step "Creating availability group on primary..."

execute_sql "$PRIMARY_CONTAINER" "
USE master;
IF EXISTS (SELECT * FROM sys.availability_groups WHERE name = '${AG_NAME}')
BEGIN
    DROP AVAILABILITY GROUP ${AG_NAME};
END

CREATE AVAILABILITY GROUP ${AG_NAME}
WITH (AUTOMATED_BACKUP_PREFERENCE = PRIMARY,
      CLUSTER_TYPE = NONE)
FOR REPLICA ON 
    'sqlserver1' WITH (
        ENDPOINT_URL = 'TCP://sqlserver1:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = MANUAL,
        SEEDING_MODE = AUTOMATIC,
        SECONDARY_ROLE (ALLOW_CONNECTIONS = ALL)
    ),
    'sqlserver2' WITH (
        ENDPOINT_URL = 'TCP://sqlserver2:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = MANUAL,
        SEEDING_MODE = AUTOMATIC,
        SECONDARY_ROLE (ALLOW_CONNECTIONS = ALL)
    );

ALTER AVAILABILITY GROUP ${AG_NAME} GRANT CREATE ANY DATABASE;
"

# Verify AG was created
AG_COUNT=$(execute_sql "$PRIMARY_CONTAINER" "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.availability_groups WHERE name = '${AG_NAME}';" | tr -d ' ')
if [ "$AG_COUNT" != "1" ]; then
    log_error "Failed to create AG on primary."
    exit 1
fi

log_info "Availability group '${AG_NAME}' created"

# ============================================================================
# STEP 7: Join Secondary to AG
# ============================================================================
log_step "Joining secondary replica to availability group..."

# For CLUSTER_TYPE = NONE on Linux, must explicitly specify cluster type in JOIN
execute_sql "$SECONDARY_CONTAINER" "
USE master;
ALTER AVAILABILITY GROUP ${AG_NAME} JOIN WITH (CLUSTER_TYPE = NONE);

ALTER AVAILABILITY GROUP ${AG_NAME} GRANT CREATE ANY DATABASE;
"

# Verify JOIN succeeded by checking if AG exists on secondary
AG_COUNT=$(execute_sql "$SECONDARY_CONTAINER" "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.availability_groups WHERE name = '${AG_NAME}';" | tr -d ' ')
if [ "$AG_COUNT" != "1" ]; then
    log_error "Failed to join secondary to AG. AG not found in sys.availability_groups on secondary."
    exit 1
fi

log_info "Secondary replica joined to ${AG_NAME}"

# Wait for AG to stabilize
sleep 3

# ============================================================================
# STEP 8: Create and Seed Test Database
# ============================================================================
log_step "Creating test database with sample data..."

execute_sql "$PRIMARY_CONTAINER" "
USE master;
IF DB_ID('${DB_NAME}') IS NOT NULL
BEGIN
    ALTER DATABASE ${DB_NAME} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE ${DB_NAME};
END

CREATE DATABASE ${DB_NAME};
ALTER DATABASE ${DB_NAME} SET RECOVERY FULL;

-- Take initial full backup to enable transaction log
BACKUP DATABASE ${DB_NAME} TO DISK = 'NUL';
" > /dev/null

log_info "Database ${DB_NAME} created with FULL recovery model"

# Create table and seed data
execute_sql "$PRIMARY_CONTAINER" "
USE ${DB_NAME};

CREATE TABLE TestData (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    TestValue NVARCHAR(100),
    CreatedAt DATETIME2 DEFAULT SYSDATETIME()
);

INSERT INTO TestData (TestValue) VALUES 
    ('Initial Row 1'),
    ('Initial Row 2'),
    ('Initial Row 3'),
    ('Initial Row 4'),
    ('Initial Row 5');
" > /dev/null

log_info "Table created and seeded with 5 rows"

# ============================================================================
# STEP 9: Add Database to Availability Group  
# ============================================================================
# NOTE: With SEEDING_MODE = AUTOMATIC, SQL Server handles backup/restore automatically
# We just add the database to the AG and it will seed to the secondary
log_step "Adding database to availability group..."

execute_sql "$PRIMARY_CONTAINER" "
USE master;
ALTER AVAILABILITY GROUP ${AG_NAME} ADD DATABASE ${DB_NAME};
"

log_info "Database added to AG on primary - automatic seeding in progress"

# Wait for automatic seeding to complete (can take a few seconds)
log_step "Waiting for automatic seeding to complete..."
sleep 10

# ============================================================================
# STEP 10: Verify AG Status
# ============================================================================
log_step "Verifying availability group status..."

echo ""
echo "=== Availability Group Status ==="
execute_sql "$PRIMARY_CONTAINER" "
SET NOCOUNT ON;
SELECT 
    ag.name AS AG_Name,
    ar.replica_server_name AS Replica,
    rs.role_desc AS Role,
    rs.connected_state_desc AS Connection_State,
    DB_NAME(drs.database_id) AS Database_Name,
    drs.synchronization_state_desc AS Sync_State,
    drs.synchronization_health_desc AS Health
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states rs ON ar.replica_id = rs.replica_id
LEFT JOIN sys.dm_hadr_database_replica_states drs ON ar.replica_id = drs.replica_id
WHERE ag.name = '${AG_NAME}'
ORDER BY ar.replica_server_name, DB_NAME(drs.database_id);
"
echo ""

# Check row count on both replicas
PRIMARY_COUNT=$(execute_sql "$PRIMARY_CONTAINER" "SET NOCOUNT ON; SELECT COUNT(*) FROM ${DB_NAME}.dbo.TestData" | xargs)
SECONDARY_COUNT=$(execute_sql "$SECONDARY_CONTAINER" "SET NOCOUNT ON; SELECT COUNT(*) FROM ${DB_NAME}.dbo.TestData" | xargs)

log_info "Row count verification:"
echo "  Primary:   $PRIMARY_COUNT rows"
echo "  Secondary: $SECONDARY_COUNT rows"

if [[ "$PRIMARY_COUNT" == "$SECONDARY_COUNT" ]]; then
    echo ""
    log_step "✅ Always On Availability Group setup complete!"
    echo ""
    echo "AG Name:      ${AG_NAME}"
    echo "Database:     ${DB_NAME}"
    echo "Primary:      sqlserver1 (port 1433)"
    echo "Secondary:    sqlserver2 (port 1434)"
    echo "Sync Mode:    SYNCHRONOUS_COMMIT"
    echo "Failover:     MANUAL"
    echo ""
    log_info "You can now test replication by inserting data on the primary:"
    echo "  docker exec $PRIMARY_CONTAINER /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '$SA_PASSWORD' -C -Q \"INSERT INTO ${DB_NAME}.dbo.TestData (TestValue) VALUES ('Test Row')\""
    echo ""
else
    log_error "Row counts don't match! Check synchronization status."
    exit 1
fi
