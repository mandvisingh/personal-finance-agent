const PII_RULES = [
  { pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,                                       label: "[SSN REDACTED]" },
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{1,4}\b/g,                                       label: (m) => `[CARD ...${m.replace(/\D/g,'').slice(-4)}]` },
  { pattern: /\bACCT?[:\s#]*(\d{5,})\b/gi,                                            label: (_, g1) => `ACCT [...${g1.slice(-4)}]` },
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,               label: "[EMAIL REDACTED]" },
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,                  label: "[PHONE REDACTED]" },
  { pattern: /\b(Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,             label: "[NAME REDACTED]" },
  { pattern: /\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl|Terr?|Cir)\b\.?/gi, label: "[ADDRESS REDACTED]" },
  { pattern: /(?<!\$)(?<!\d)\b\d{5}(-\d{4})?\b(?!\d)/g,                             label: "[ZIP REDACTED]" },
  { pattern: /\b(DOB|Date of Birth)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/gi,      label: "[DOB REDACTED]" },
];

export function prescrubText(text) {
  let s = text;
  for (const rule of PII_RULES) {
    s = typeof rule.label === "function"
      ? s.replace(rule.pattern, rule.label)
      : s.replace(rule.pattern, rule.label);
  }
  return s;
}

export function prescrubWithStats(text) {
  let s = text;
  const counts = {};
  for (const rule of PII_RULES) {
    const matches = s.match(rule.pattern) ?? [];
    if (matches.length > 0) {
      const key = typeof rule.label === "function" ? rule.label(matches[0], ...(matches[0].match(rule.pattern) ?? [])) : rule.label;
      const label = key.replace(/\[|\]/g, '').replace(/ REDACTED| \.\.\.\w+/g, '').trim();
      counts[label] = (counts[label] || 0) + matches.length;
    }
    s = typeof rule.label === "function"
      ? s.replace(rule.pattern, rule.label)
      : s.replace(rule.pattern, rule.label);
  }
  return { scrubbed: s, counts };
}
