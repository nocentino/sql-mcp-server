# Always On Availability Group Setup

## Overview
Successfully configured a cluster-less Always On Availability Group (TestAG) between two SQL Server 2025 instances using certificate-based authentication.

## Infrastructure
- **Primary Replica**: sqlserver (container: sql-mcp-sqlserver, port: 1433)
- **Secondary Replica**: sqlserver2 (container: sql-mcp-sqlserver2, port: 1434)
- **Network**: sql-mcp-network (Docker bridge network)
- **AG Name**: TestAG
- **Database**: TestDB (Orders table with 5 sample records)

## Configuration Details

### Certificate Authentication
- Each server has its own certificate for endpoint authentication
- Certificates exchanged and mutual trust established
- Logins created: sqlserver1_login, sqlserver2_login

### Endpoints
- **Name**: AGEndpoint
- **Protocol**: TCP
- **Port**: 5022
- **Authentication**: Certificate-based
- **Role**: ALL (can be primary or secondary)

### Availability Group Settings
- **Cluster Type**: NONE (cluster-less)
- **Availability Mode**: SYNCHRONOUS_COMMIT
- **Failover Mode**: MANUAL
- **Seeding Mode**: MANUAL
- **Automated Backup Preference**: PRIMARY

## Current Status
```
TestAG Status:
- Primary: sqlserver (ONLINE, CONNECTED)
- Secondary: sqlserver2 (ONLINE, CONNECTED)

TestDB Synchronization:
- sqlserver: SYNCHRONIZED, HEALTHY
- sqlserver2: SYNCHRONIZED, HEALTHY
- Log Send Queue: 0 KB
- Redo Queue: 0 KB
```

## Test Data
The TestDB.dbo.Orders table contains 5 sample orders:
1. Acme Corp - $1,250.00 (Completed)
2. TechStart Inc - $3,400.50 (Pending)
3. Global Supplies - $875.25 (Shipped)
4. DataSoft LLC - $2,100.00 (Completed)
5. Cloud Systems - $5,600.75 (Processing)

Data is synchronized and queryable on both replicas.

## Scripts Created
1. `setup-ag.sql` - Primary server certificate and endpoint setup
2. `setup-ag-sqlserver2.sql` - Secondary server certificate and endpoint setup
3. `setup-ag-trust1.sql` - Import secondary certificate on primary
4. `setup-ag-trust2.sql` - Import primary certificate on secondary
5. `create-ag.sql` - Create availability group
6. `create-testdb.sql` - Create and seed test database
7. `restore-testdb.sql` - Restore database on secondary with NORECOVERY
8. `join-ag.sql` - Join secondary to AG (updated to use CLUSTER_TYPE = NONE)
9. `add-db-to-ag.sql` - Add database to AG on primary
10. `verify-ag.sql` - Comprehensive status verification script

## Connection Info
- **SA Password**: S0methingS@Str0ng!
- **Master Key Password**: S0methingS@Str0ng!AG
- **Primary Connection**: sqlserver:1433
- **Secondary Connection**: sqlserver2:1434 (read-only)

## Key Learnings
1. HADR must be enabled via `MSSQL_ENABLE_HADR=1` environment variable
2. Certificate files require `mssql:mssql` ownership in containers
3. Cluster-less AGs require `CLUSTER_TYPE = NONE` in both CREATE and JOIN statements
4. Database must be in FULL recovery mode with at least one full backup before adding to AG
5. Secondary database must be restored with NORECOVERY before joining AG

## Verification Commands
```bash
# Check AG status on primary
docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'S0methingS@Str0ng!' -C -i /tmp/verify-ag.sql -W

# Check AG status on secondary
docker exec sql-mcp-sqlserver2 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'S0methingS@Str0ng!' -C -i /tmp/verify-ag.sql -W

# Query data on primary
docker exec sql-mcp-sqlserver1 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'S0methingS@Str0ng!' -C -Q "SELECT * FROM TestDB.dbo.Orders;" -W

# Query data on secondary (read-only)
docker exec sql-mcp-sqlserver2 /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'S0methingS@Str0ng!' -C -Q "SELECT * FROM TestDB.dbo.Orders;" -W
```

## Next Steps
- Test failover scenarios
- Add more databases to the AG
- Configure automatic seeding for new databases
- Set up monitoring and alerting
- Test connection routing for read-only workloads
