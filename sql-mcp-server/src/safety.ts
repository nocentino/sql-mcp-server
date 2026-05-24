/**
 * Query safety validation.
 * Defense-in-depth: the dba_monitor SQL account has no DML/DDL permissions,
 * but we block obviously dangerous patterns for better error messages.
 */

const ALLOWED_START = /^\s*(SELECT|WITH|DECLARE)\b/i;

const BLOCKED_PATTERNS = [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER|LOGIN|USER)\b/i,
  /\bCREATE\s+(TABLE|DATABASE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER|LOGIN|USER)\b/i,
  /\bALTER\s+(TABLE|DATABASE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER|LOGIN|USER)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bXP_CMDSHELL\b/i,
  /\bOPENROWSET\b/i,
  /\bOPENDATASOURCE\b/i,
  /\bBULK\s+INSERT\b/i,
  /\bSHUTDOWN\b/i,
  /\bSP_CONFIGURE\b/i,
  /\bSELECT\s+INTO\s+[^@#]/i, // SELECT INTO permanent table (allow #temp and @table vars)
  /;\s*(EXEC|EXECUTE)\b/i,    // multi-statement to bypass ALLOWED_START check
];

export function validateQuery(query: string): { valid: boolean; reason?: string } {
  const trimmed = query.trim();

  if (!ALLOWED_START.test(trimmed)) {
    return {
      valid: false,
      reason:
        "Only SELECT, WITH (CTE), or DECLARE statements are allowed. Received: " +
        trimmed.substring(0, 50),
    };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        reason: `Query contains a blocked keyword matching pattern: ${pattern.source}`,
      };
    }
  }

  return { valid: true };
}
