/**
 * Query safety validation.
 * Defense-in-depth: the dba_monitor SQL account has no DML/DDL permissions,
 * but we block obviously dangerous patterns for better error messages.
 *
 * Patterns match the bare keyword, not a two-word phrase: T-SQL accepts
 * `INSERT dbo.T` without INTO, `DELETE dbo.T` without FROM, and `EXEC` on a
 * new line without a preceding semicolon, so phrase-level patterns are
 * trivially bypassed. Word boundaries keep DMV names such as dm_exec_requests,
 * leaf_insert_count and last_updated from matching.
 *
 * String literals are blanked out before matching so that legitimate audit
 * queries like `WHERE permission_name = 'DELETE'` are not rejected. A keyword
 * inside a literal cannot execute on its own, and the EXEC that would be
 * needed to run it is blocked.
 */

const ALLOWED_START = /^\s*(SELECT|WITH|DECLARE)\b/i;

const BLOCKED_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\s+\w/i,
  /\bDELETE\b/i,
  /\bMERGE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\b(DROP|CREATE|ALTER)\s+(TABLE|DATABASE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER|LOGIN|USER|ROLE|SCHEMA)\b/i,
  /\b(GRANT|REVOKE|DENY)\b/i,
  /\b(EXEC|EXECUTE)\b/i,
  /\bSP_EXECUTESQL\b/i,
  /\bXP_CMDSHELL\b/i,
  /\bOPENROWSET\b/i,
  /\bOPENDATASOURCE\b/i,
  /\bOPENQUERY\b/i,
  /\bBULK\s+INSERT\b/i,
  /\bSHUTDOWN\b/i,
  /\bKILL\b/i,
  /\bSP_CONFIGURE\b/i,
  /\bRECONFIGURE\b/i,
  /\bINTO\s+(?![@#])/i,   // SELECT ... INTO permanent table (allow #temp); INSERT/MERGE INTO already blocked above
];

// Replace the contents of every '...' literal (with '' escapes) by an empty
// literal, so keywords inside quoted data are not treated as statements.
function stripStringLiterals(sqlText: string): string {
  return sqlText.replace(/N?'(?:[^']|'')*'/g, "''");
}

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

  const code = stripStringLiterals(trimmed);
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return {
        valid: false,
        reason: `Query contains a blocked keyword matching pattern: ${pattern.source}`,
      };
    }
  }

  return { valid: true };
}
