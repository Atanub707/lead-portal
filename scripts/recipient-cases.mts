import { classifyRecipient } from "../src/lib/recipient.ts";

const cases = [
  { name: "CEO verified", email: "ceo@acme.com", contactName: "Jane Smith", contactTitle: "CEO", emailStatus: "verified" },
  { name: "CTO verified", email: "john@acme.com", contactName: "John Doe", contactTitle: "CTO", emailStatus: "verified" },
  { name: "unverified personal", email: "jane.smith@acme.com", contactName: "Jane Smith", contactTitle: "Founder", emailStatus: "found" },
  { name: "personal-looking unknown", email: "john@acme.com" },
  { name: "info", email: "info@acme.com" },
  { name: "sales", email: "sales@acme.com" },
  { name: "support", email: "support@acme.com" },
  { name: "security", email: "security@acme.com" },
  { name: "compliance", email: "compliance@acme.com" },
  { name: "legal", email: "legal@acme.com" },
  { name: "partnerships", email: "partnerships@acme.com" },
  { name: "careers", email: "careers@acme.com" },
  { name: "noreply", email: "noreply@acme.com" },
  { name: "unknown", email: "hello123@acme.com" },
];

let failures = 0;
for (const testCase of cases) {
  const profile = classifyRecipient(testCase);
  const ok = profile.type && profile.strategy && profile.greeting;
  if (!ok) failures += 1;
  console.log(
    `${testCase.name.padEnd(26)} type=${profile.type.padEnd(8)} category=${profile.category.padEnd(12)} strategy=${profile.strategy.padEnd(20)} greeting="${profile.greeting}"`
  );
}
if (failures > 0) process.exit(1);
