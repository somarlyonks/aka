INSERT INTO aliases (word, content, secret, created_at, expires_at)
VALUES (
  'terms-of-use',
  'TERMS OF USE
Last updated: October 31, 2026

These Terms govern your use of aka (the "Service"), an alias service that stores a long string under a short word. By creating, opening, or deleting an alias, or otherwise using the Service, you agree to these Terms. If you do not agree, do not use the Service.

1. THE SERVICE
aka stores a non-empty string (the "content") under a short word (the "word"). Visiting the word returns the content: an absolute http: or https: URL is redirected to, and other text is returned as plain text. The Service offers chosen or generated words, public and private aliases, finite lifetimes, and one-time aliases. It is a convenience tool, not a file host, backup service, password manager, secure messenger, or permanent link shortener. We may add, remove, limit, or change features and limits at any time.

2. ELIGIBILITY
You must be legally capable of entering into a binding contract and must use the Service in compliance with all applicable laws. If you use the Service for an organization, you represent that you have authority to bind it. The Service is not directed to children under 13.

3. YOUR CONTENT
You retain ownership of your content. You grant us a limited, non-exclusive, worldwide, royalty-free license to store, encrypt, decrypt, transmit, display, and process it solely to operate, secure, and maintain the Service and to comply with law. You represent that you have all rights needed to submit the content, that it is lawful, and that it does not infringe the rights of others. You are responsible for the content you store and for the consequences of sharing its word or secret. We do not pre-screen content and have no duty to monitor aliases, but we may remove or block content when necessary.

Do not store sensitive information. The Service is not intended for passwords, private keys, API keys, recovery codes, authentication tokens, financial or health information, government identifiers, confidential business information, precise location data, or personal information about other people. Content submitted through the create paths is limited to 8,192 UTF-8 bytes, and the word must be 2-32 ASCII characters using lowercase letters, digits, dashes, or underscores.

4. WORDS, SECRETS, AND ACCESS
Anyone who knows a public word can read its content. Words are short and may be guessable, so a public word is not a secret. A private alias requires the exact secret as an Authorization: Bearer header on every read. The Service does not place secrets in URLs or Location headers and does not use cookies or sessions. You are responsible for choosing a strong secret, sharing it securely, keeping it out of logs and screenshots, and remembering it. There is no account, password reset, secret recovery, or support process that can restore access. Anyone with the word and secret can read the alias. A one-time alias may be consumed by a crawler, link preview, email scanner, or prefetcher before the intended recipient opens it; do not use public one-time links for sensitive material. We may rate-limit or block requests, including failed secret attempts, to protect the Service.

5. LIFETIME, IMMUTABILITY, AND DELETION
Every alias you create has a lifetime fixed at creation. The default is one week and the maximum is thirty days. A lifetime of 0 creates a one-time alias, destroyed after its first successful read. Once created, the word, content, secret, and lifetime are immutable; existing words cannot be overwritten and no editing operation is provided. Expired aliases may return 410 Gone and be deleted. One-time aliases are consumed atomically; concurrent requests may race, and only the request that deletes the row receives the content. Deletion is available through the API for private aliases only, using the secret in a JSON body. Public aliases cannot be deleted through the Service. We do not guarantee that deleted, expired, or one-time content is immediately removed from every transient copy held by hosting infrastructure, caches, or network providers.

6. PROHIBITED CONTENT AND CONDUCT
You must not use the Service for illegal content or activity; child sexual abuse material or exploitation of minors; non-consensual intimate imagery; harassment, threats, stalking, hate speech, or incitement to violence; doxxing or privacy violations; malware, spyware, ransomware, or links to malicious software; phishing, credential harvesting, fraud, scams, or impersonation; spam, link farms, or deceptive redirect chains; infringement of copyright, trademark, or other intellectual property; violations of export control or sanctions laws; facilitating unauthorized access to systems or data; evading rate limits or security controls; or use in critical infrastructure, medical devices, or safety systems where failure could cause serious harm. You must not probe or scan the Service without permission, access aliases or secrets that are not yours, overload the Service, or use it to attack another system.

7. FAIR USE AND AUTOMATED ACCESS
The Service is shared infrastructure. Use it reasonably and do not place an unreasonable load on it. We may apply rate limits and other safeguards. Do not circumvent or evade those safeguards. Automated access is permitted only for lawful, low-volume use that respects these Terms. Do not scrape at scale, enumerate words, probe for private aliases, or create aliases for spam. We may block automated traffic that we believe is abusive.

8. PRIVACY AND SECURITY
aka does not require an account and does not use cookies, sessions, or third-party analytics. The Worker does not intentionally emit application logs. Our hosting provider may process standard request metadata, such as IP addresses, headers, timestamps, and error information, under its own policies. User-created content is encrypted at rest with AES-256-GCM. The key depends on the alias and, for private aliases, on the plaintext secret; the stored secret is an HMAC rather than the secret itself. The Service decrypts content in memory when serving a valid request. This is encryption at rest, not end-to-end encryption: the Service must be able to read the content to return it. Do not treat aka as a secrecy guarantee. We may access, preserve, or disclose information when we believe it is necessary to comply with law, enforce these Terms, protect the Service or others, or respond to a valid legal request. No method of transmission or storage is perfectly secure, and unauthorized access, data loss, and service interruption are possible.

9. THIRD-PARTY LINKS
An alias may redirect to a third-party website or contain third-party text. We do not control, endorse, or verify third-party sites or content. A short link can point anywhere, including to harmful or misleading material. Inspect the destination before entering credentials, making payments, or sharing personal information. Your use of a third-party site is governed by that site''s terms and privacy policy.

10. INTELLECTUAL PROPERTY
The Service, including its software, design, text, graphics, logos, and the "aka" name, is owned by the operator or its licensors. The source code is available under the MIT License at https://github.com/somarlyonks/aka; that license applies to the code as stated in the repository. These Terms do not grant you any right to use our name, logo, or branding except as necessary to refer to the Service or as permitted by the MIT License. You retain ownership of your content and grant us only the limited license described above. If you send feedback or suggestions, you grant us a perpetual, irrevocable, worldwide, royalty-free license to use them without compensation or attribution.

11. AVAILABILITY AND CHANGES
The Service is provided free of charge and on an "as available" basis. We do not promise uptime, performance, availability, or continuity. The Service may be unavailable because of maintenance, capacity limits, network problems, provider outages, security incidents, or decisions by us. We may change, limit, suspend, or discontinue the Service or any feature at any time. We do not guarantee that an alias will remain available for its full lifetime, that content will not be lost, or that the Service will continue to exist. Keep your own copy of anything important.

12. DISCLAIMER OF WARRANTIES
To the maximum extent permitted by law, the Service is provided "as is", "as available", and with all faults. We disclaim all warranties, express, implied, statutory, or otherwise, including merchantability, fitness for a particular purpose, title, non-infringement, accuracy, security, and uninterrupted or error-free operation. Some jurisdictions do not allow the exclusion of certain warranties, so some exclusions may not apply to you. Nothing in these Terms excludes a right that cannot lawfully be excluded.

13. LIMITATION OF LIABILITY
To the maximum extent permitted by law, we will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue, data, goodwill, business opportunity, or anticipated savings, arising out of or relating to your use of or inability to use the Service, even if advised of the possibility. Our total aggregate liability for all claims relating to the Service or these Terms will not exceed the greater of the amount you paid us in the twelve months before the claim, if any, and zero US dollars (USD 0). Nothing here limits liability for fraud, willful misconduct, death or personal injury caused by negligence, or any liability that cannot be limited by law. If you are a consumer, you keep your mandatory statutory rights.

14. INDEMNIFICATION
To the maximum extent permitted by law, you agree to defend, indemnify, and hold harmless the operator of aka, its contributors, and its service providers from claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of your content, your use of the Service, your breach of these Terms or applicable law, or your violation of a third party''s rights. We may participate in the defense at our own expense.

15. SUSPENSION AND TERMINATION
You may stop using the Service at any time. We may suspend, restrict, or terminate your access, or remove or block any alias, immediately and without notice if we believe you violated these Terms, created risk or legal exposure, or that suspension is necessary to protect the Service or others. If your access is terminated, stop using the Service. Provisions that by their nature should survive termination will survive.

16. CHANGES TO THESE TERMS
We may update these Terms from time to time. The updated version will be posted on the Service with a new "Last updated" date. If a change is material, we may provide additional notice on the Service or in the project repository. By continuing to use the Service after the updated Terms take effect, you agree to them. If you do not agree, stop using the Service.

17. GOVERNING LAW AND DISPUTES
These Terms and any dispute relating to them or the Service are governed by the laws of the jurisdiction in which the operator of aka is established, without regard to conflict-of-laws principles. The courts located in that jurisdiction will have exclusive jurisdiction, except where mandatory law gives you the right to bring a claim elsewhere or requires a different forum. Before starting a formal dispute, contact us through the project issue tracker and give us a reasonable opportunity to resolve the matter informally. Nothing in these Terms prevents you from exercising mandatory consumer-protection rights.

18. GENERAL
These Terms and any notices published on the Service are the entire agreement between you and us regarding the Service. If any provision is held invalid or unenforceable, the remaining provisions remain in full force, and the invalid provision will be enforced to the maximum extent permitted by law. Our failure to enforce a provision is not a waiver. You may not assign these Terms without our prior written consent; we may assign them to an affiliate, successor, or purchaser of the Service. These Terms do not create rights for anyone other than you and us, except that our contributors and service providers may enforce provisions intended to benefit them. Section headings are for convenience only. You agree that these Terms may be accepted electronically.

19. CONTACT AND COMPLAINTS
Questions, complaints, and reports of abuse or infringement can be sent through the project issue tracker at https://github.com/somarlyonks/aka/issues. Include enough detail to locate the alias, such as the word and a description of the problem. Do not include a secret, personal data, or other sensitive information in a public issue. We are a small project and may not respond to every message. We may remove or block content that we believe violates these Terms or the law, but we are not obligated to monitor the Service or to take any particular action in response to a report.
',
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER),
  NULL
);
