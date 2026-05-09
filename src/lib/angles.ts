export type Angle = { id: string; label: string };

export const ANGLES: Angle[] = [
  { id: "sql_injection", label: "SQLi" },
  { id: "command_injection", label: "Cmd Inj" },
  { id: "path_traversal", label: "Path" },
  { id: "ssrf", label: "SSRF" },
  { id: "xss", label: "XSS" },
  { id: "authn_bypass", label: "Authn" },
  { id: "authz_idor", label: "IDOR" },
  { id: "secrets", label: "Secrets" },
  { id: "weak_crypto", label: "Crypto" },
  { id: "deserialization", label: "Deser" },
  { id: "race", label: "Race" },
  { id: "proto_pollution", label: "Proto" },
  { id: "open_redirect", label: "Redir" },
  { id: "vuln_deps", label: "Deps" },
  { id: "csrf", label: "CSRF" },
];
