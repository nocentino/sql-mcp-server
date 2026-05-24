#!/bin/bash

# Quick smoke test - validates basic tool functionality
# Tests the tools directly through SQL queries to verify T-SQL correctness

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

echo "=== SQL MCP Server Tool Smoke Test ==="
echo ""

function sql_test() {
  local description="$1"
  local query="$2"
  local expect_rows="${3:-any}"
  
  echo -n "  ${description}... "
  
  local result
  result=$(docker compose exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U dba_monitor -P 'MonitorP@ss123!' -C -d master \
    -Q "${query}" -h -1 -W 2>&1)
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}✗${NC}"
    echo "    Error: ${result}" | head -3
    FAIL=$((FAIL+1))
    return 1
  fi
  
  if [ "$expect_rows" = "any" ]; then
    # Just check query ran without error
    echo -e "${GREEN}✓${NC}"
    PASS=$((PASS+1))
  elif [ "$expect_rows" = "none_ok" ]; then
    # Empty result set is acceptable
    echo -e "${GREEN}✓${NC}"
    PASS=$((PASS+1))
  else
    # Check for at least some rows
    local row_count=$(echo "$result" | grep -v "^$" | wc -l | tr -d ' ')
    if [ "$row_count" -gt "0" ]; then
      echo -e "${GREEN}✓${NC} (${row_count} rows)"
      PASS=$((PASS+1))
    else
      echo -e "${YELLOW}SKIP${NC} (no data)"
      SKIP=$((SKIP+1))
    fi
  fi
}

function test_category() {
  echo -e "${YELLOW}$1${NC}"
}

# Verify dba_monitor can connect
echo "Checking dba_monitor connection..."
if ! docker compose exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U dba_monitor -P 'MonitorP@ss123!' -C -d master \
  -Q "SELECT @@VERSION" -h -1 > /dev/null 2>&1; then
  echo -e "${RED}ERROR: Cannot connect as dba_monitor${NC}"
  exit 1
fi
echo -e "${GREEN}dba_monitor connected${NC}\n"

# Test queries from each tool category
test_category "Session Monitoring"
sql_test "Active sessions" \
  "SELECT TOP 5 session_id, login_name, status FROM sys.dm_exec_sessions WHERE is_user_process=1"

sql_test "Blocking chains" \
  "SELECT TOP 5 session_id, blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id > 0" \
  "none_ok"

test_category "Query Performance"
sql_test "Top queries by CPU" \
  "SELECT TOP 5 execution_count, total_worker_time FROM sys.dm_exec_query_stats ORDER BY total_worker_time DESC"

test_category "Wait Statistics"
sql_test "Wait stats" \
  "SELECT TOP 10 wait_type, wait_time_ms FROM sys.dm_os_wait_stats WHERE wait_time_ms > 0 ORDER BY wait_time_ms DESC"

sql_test "Latch stats" \
  "SELECT TOP 5 latch_class, wait_time_ms FROM sys.dm_os_latch_stats WHERE wait_time_ms > 0 ORDER BY wait_time_ms DESC"

test_category "I/O & Storage"
sql_test "File I/O stats" \
  "SELECT TOP 5 DB_NAME(database_id) AS db, num_of_reads, num_of_writes FROM sys.dm_io_virtual_file_stats(NULL, NULL) ORDER BY num_of_reads DESC"

sql_test "Database files" \
  "SELECT TOP 5 DB_NAME(database_id) AS db_name, name, type_desc, size*8/1024 AS size_mb FROM sys.master_files ORDER BY size DESC"

sql_test "VLF count (master)" \
  "SELECT COUNT(*) AS vlf_count FROM sys.dm_db_log_info(DB_ID('master'))"

test_category "Memory"
sql_test "Memory usage" \
  "SELECT total_physical_memory_kb/1024 AS total_mb, available_physical_memory_kb/1024 AS avail_mb FROM sys.dm_os_sys_memory"

sql_test "Buffer pool" \
  "SELECT COUNT(*)*8/1024 AS buffer_mb FROM sys.dm_os_buffer_descriptors WHERE database_id > 0"

sql_test "TempDB usage" \
  "SELECT SUM(user_object_reserved_page_count)*8/1024 AS user_mb FROM sys.dm_db_file_space_usage"

test_category "Index & Statistics"
sql_test "Missing indexes" \
  "SELECT TOP 5 user_seeks, avg_user_impact FROM sys.dm_db_missing_index_group_stats ORDER BY user_seeks DESC" \
  "none_ok"

sql_test "Index usage" \
  "SELECT TOP 5 database_id, object_id, user_seeks, user_scans FROM sys.dm_db_index_usage_stats WHERE database_id > 4 ORDER BY user_seeks DESC" \
  "none_ok"

test_category "Server Info"
sql_test "Server properties" \
  "SELECT SERVERPROPERTY('ProductVersion') AS version, SERVERPROPERTY('Edition') AS edition"

sql_test "CPU info" \
  "SELECT cpu_count, physical_memory_kb/1024 AS memory_mb FROM sys.dm_os_sys_info"

sql_test "Configuration" \
  "SELECT TOP 5 name, value_in_use FROM sys.configurations ORDER BY name"

test_category "Backup & Jobs"
sql_test "Database backup status" \
  "SELECT TOP 5 d.name, d.recovery_model_desc FROM sys.databases d WHERE d.database_id > 4 ORDER BY d.name"

sql_test "SQL Agent jobs" \
  "SELECT COUNT(*) AS job_count FROM msdb.dbo.sysjobs"

test_category "Performance Counters"
sql_test "Perfmon counters" \
  "SELECT TOP 5 object_name, counter_name, cntr_value FROM sys.dm_os_performance_counters WHERE cntr_value > 0 ORDER BY object_name"

echo ""
echo "=== Results ==="
TOTAL=$((PASS + FAIL + SKIP))
echo "Total: ${TOTAL}"
echo -e "${GREEN}Passed: ${PASS}${NC}"
echo -e "${RED}Failed: ${FAIL}${NC}"
echo -e "${YELLOW}Skipped: ${SKIP}${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "\n${GREEN}✓ Smoke test passed - all tool queries are valid${NC}"
  exit 0
else
  echo -e "\n${RED}✗ Some tests failed${NC}"
  exit 1
fi
