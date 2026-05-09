// Pinned to juice-shop tag v17.x. Sources: https://pwning.owasp-juice.shop/
// File paths are repo-root-relative POSIX (matching repo.ts:55 output).
// Line numbers verified against juice-shop/v17.0.0 manually.

export type TruthRow = {
  file: string;
  lineStart: number;
  lineEnd: number;
  cwe?: string;
  title: string;
  source: string;
};

export const JUICE_SHOP_TRUTH: TruthRow[] = [
  {
    file: "routes/login.ts",
    lineStart: 35,
    lineEnd: 60,
    cwe: "CWE-89",
    title: "SQL Injection in login query",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/injection.html#log-in-with-the-administrators-user-account",
  },
  {
    file: "routes/search.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-89",
    title: "SQL Injection via search query",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/injection.html",
  },
  {
    file: "routes/userProfile.ts",
    lineStart: 1,
    lineEnd: 100,
    cwe: "CWE-94",
    title: "SSTI in user profile page",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/injection.html#perform-a-server-side-request-forgery",
  },
  {
    file: "routes/fileUpload.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-434",
    title: "Unrestricted file upload",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/improper-input-validation.html",
  },
  {
    file: "routes/fileServer.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-22",
    title: "Path traversal in file server",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/redirect.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-601",
    title: "Open redirect via allowlist bypass",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/unvalidated-redirects.html",
  },
  {
    file: "routes/basket.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-639",
    title: "IDOR in basket access",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/changePassword.ts",
    lineStart: 1,
    lineEnd: 50,
    cwe: "CWE-352",
    title: "CSRF on password change endpoint",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-authentication.html",
  },
  {
    file: "routes/coupon.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-1023",
    title: "Weak coupon code validation",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/improper-input-validation.html",
  },
  {
    file: "routes/order.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-639",
    title: "IDOR in order details",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/dataExport.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-200",
    title: "Sensitive data export",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/sensitive-data-exposure.html",
  },
  {
    file: "lib/insecurity.ts",
    lineStart: 1,
    lineEnd: 100,
    cwe: "CWE-327",
    title: "Weak crypto / hardcoded secret",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/cryptographic-issues.html",
  },
  {
    file: "routes/feedback.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-79",
    title: "Stored XSS via feedback comment",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/xss.html",
  },
  {
    file: "routes/track.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-79",
    title: "Reflected XSS in track-result",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/xss.html",
  },
  {
    file: "routes/saveLoginIp.ts",
    lineStart: 1,
    lineEnd: 40,
    cwe: "CWE-345",
    title: "Trust of unverified header",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-authentication.html",
  },
  {
    file: "routes/2fa.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-287",
    title: "2FA bypass via parameter tampering",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-authentication.html",
  },
  {
    file: "routes/payment.ts",
    lineStart: 1,
    lineEnd: 80,
    cwe: "CWE-840",
    title: "Negative amount in payment",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/improper-input-validation.html",
  },
  {
    file: "routes/recycles.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-639",
    title: "IDOR in recycle item access",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/broken-access-control.html",
  },
  {
    file: "routes/profileImageUrlUpload.ts",
    lineStart: 1,
    lineEnd: 60,
    cwe: "CWE-918",
    title: "SSRF via profile image URL",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/server-side-request-forgery.html",
  },
  {
    file: "frontend/src/app/login/login.component.ts",
    lineStart: 1,
    lineEnd: 100,
    cwe: "CWE-798",
    title: "Hardcoded credentials in client",
    source: "https://pwning.owasp-juice.shop/companion-guide/latest/part2/sensitive-data-exposure.html",
  },
];
