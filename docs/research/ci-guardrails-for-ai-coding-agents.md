# CI Guardrails for Repositories Built with AI Coding Agents

Deep research report — verified tool landscape and recommended architecture.
Researched 2026-09-26 via a 21-agent workflow (7 search angles + adversarial fact-checking + completeness critique); all subagents ran on the `sonnet` model.

**Confidence legend** used throughout:

- ✅ — confirmed by 3-vote adversarial verification against current web sources (2/3+ votes)
- ◐ — single-source or community-sourced; plausible but not adversarially verified
- ✗ — claim surfaced during research that verification refuted; the correction is stated

Pricing and feature details in this market change fast (two tools changed ownership or pricing models within the last 12 months). Re-check official pages before purchase decisions.

---

## 1. Executive summary

1. **No single tool is the guardrail.** Community consensus for repos where AI agents write most of the code is a _layered pipeline_: deterministic gates (tests, types, lint, quality gates, SAST/secrets/dependency scanning) → one AI reviewer bot on the PR → human ownership gates (CODEOWNERS, branch protection, approval rules) → agent containment (sandboxing, tool allowlists, hooks). Vendors explicitly market this as "zero-trust verification" of agent output.
2. **Of the names you listed:** SonarQube, CodeRabbit and Greptile are exactly what you remembered; **Gitar is real (gitar.ai) and was acquired by Sonar on 2026-05-21** ✅, so SonarQube + Gitar now form a single two-layer offering; **Google's Gemini offering existed and still exists in paid form** (Gemini Code Assist for GitHub — the free consumer app was shut down 2026-07-17 ◐, enterprise editions continue ✅, and the free `gemini-cli` GitHub Action remains); **Wiz is not an AI code reviewer** — it is a CNAPP vendor (acquired by Google, closed 2026-03-11, $32B ✅) whose Wiz Code module is an enterprise, sales-led _security_ gate for pipelines.
3. **The empirical case for gating is strong:** Veracode's 2025 report found **45% of AI-generated tasks contained security flaws** ✅; a USENIX 2025 study found LLMs hallucinate package names **5.2–21.7% of the time** ✅ (the seedbed of "slopsquatting" supply-chain attacks); Sonar reports customers accepting **>95% of AI PRs unreviewed** ◐.
4. **Platform-native guardrails are now sufficient for many teams:** GitHub Copilot code review can be auto-assigned to every PR and — since 2026-09-01, off by default — **can submit approving reviews** ✗(correction: the "comment-only" assumption is outdated); GitLab ships Duo Code Review plus the approval-settings that block agent self-approval.
5. **The newest risk surface is the pipeline itself:** agents operating CI are exposed to prompt injection through issues/PRs/CI config (a CVSS 10.0 CVE in Google's own `run-gemini-cli` Action ✅ demonstrated the full chain), which is why pipeline-config auditing (zizmor), secret hygiene and action pinning belong on the mandatory list.

---

## 2. Why AI-agent code needs guardrails — the evidence

| Finding                                                                                                                                                                                                                               | Status | Source                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 45% of AI-generated code contained security flaws; models failed XSS tasks 86% and log-injection 88% of the time; Java passed only 29% (Veracode 2025 GenAI Code Security Report, 100+ LLMs, 80 tasks)                                | ✅     | [Veracode blog](https://www.veracode.com/blog/ai-generated-code-security-risks)                                                  |
| Code-generating LLMs hallucinate non-existent packages at ≥5.2% (commercial) and 21.7% (open-source) of references; 205,474 unique hallucinated names catalogued (USENIX Security 2025, Spracklen et al., UTSA)                       | ✅     | [arXiv 2406.10279](https://arxiv.org/abs/2406.10279)                                                                             |
| "Slopsquatting": attackers pre-register the package names LLMs predictably hallucinate (term publicized by Socket, Apr 2025; formalized in ENISA's 2025 Threat Landscape)                                                             | ◐      | [Socket blog](https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks)       |
| Sonar CEO reports customers whose developers accept >95% of AI-generated PRs without scrutiny                                                                                                                                         | ◐      | [Sonar: Seven habits of highly effective AI coding](https://www.sonarsource.com/blog/seven-habits-of-highly-effective-ai-coding) |
| 1 in 5 organizations run "vibe-coded" apps with recurring high-impact flaws: client-side-only auth, API keys hardcoded in client JS, exposed Supabase tables (Wiz Research)                                                           | ◐      | [Wiz blog](https://www.wiz.io/blog/common-security-risks-in-vibe-coded-apps)                                                     |
| Widely-cited duplication statistics (8× increase in duplicated blocks, refactoring decline) come from GitClear's research, **not** Sonar; no primary Sonar publication with a duplication percentage was located during this research | ◐      | (attribution caveat)                                                                                                             |

---

## 3. The consensus architecture: five layers

Every angle of this research (vendor docs, practitioner blogs, HN threads) converges on the same shape. The PR is the control point; deterministic checks gate it, an AI reviewer annotates it, a human owns it, and the agent that produced it is contained.

```
Layer 5  Agent containment & fleet governance
         sandboxing, tool allowlists, hooks, agent policies, audit logs
Layer 4  Human ownership gates
         CODEOWNERS, branch protection, required approvals, no self-approval
Layer 3  AI review on the PR (exactly one bot)
         CodeRabbit / Greptile / Gitar / Copilot / Gemini / Codex / Duo / Q
Layer 2  Security scanning gates
         SAST, SCA/slopsquatting, secrets, pipeline-config audit, provenance
Layer 1  Deterministic verification gates
         tests, typecheck, lint, coverage, quality gate, mutation testing
```

Key principles distilled from vendor and community guidance:

- **Deterministic before probabilistic.** Tests/linters/quality gates are reproducible and uninfluenceable; LLM review is advisory. Sonar frames this as the deterministic layer of a "zero-trust verification" loop ✅ ([CI verification loop docs](https://docs.sonarsource.com/agent-centric-development-cycle/in-your-pull-requests-the-ci-verification-loop/ci-verification-loop.md)).
- **Tests must not be written by the same agent that wrote the code** — reward hacking is a documented failure mode; write tests first or independently, and prefer a _mutation score_ over coverage alone (AI tests hit high coverage with hollow assertions) ◐ ([Sonar](https://www.sonarsource.com/blog/seven-habits-of-highly-effective-ai-coding), [mutation-testing guide](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code)).
- **Hooks are enforcement; instructions are advice.** Anthropic's own guidance: deterministic hooks "must always pass", unlike `CLAUDE.md` instructions which are advisory; run headless (`claude -p`) with `--allowedTools` allowlists in CI ◐ ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)).
- **Automation does not replace ownership or approval.** Track escaped defects and revert rate, not PR volume; route sensitive paths (auth, billing, migrations) to human owners via CODEOWNERS ◐ ([Factory: reviewing agent-generated PRs at scale](https://factory.com/articles/reviewing-agent-generated-pull-requests)).

---

## 4. The six tools you named — detailed verdicts

### 4.1 SonarQube (Sonar) — the deterministic quality gate ✅

The strongest match for "CI guardrail for AI code" in the whole landscape, and the incumbent (claims 7M+ developers, 75% of Fortune 100 ◐).

- **AI Code Assurance** (announced 2024-10-03 ✗ — verification corrected the date research initially surfaced) — a governance workflow with three mechanisms ✅: flag the project as "Contains AI-generated code" (setting or API), apply a quality gate qualified for AI Code Assurance, and optionally publish a pass/fail badge. [Docs](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/ai-code-assurance/overview.md).
- **"Sonar way for agentic AI" quality gate** (replaces the 2024-era "Sonar way for AI Code", now legacy) — six new-code conditions ✅: no new Reliability issues ≥ Low, no new Security issues ≥ Low, no new Maintainability issues ≥ Medium, no new Dependency Risks ≥ Low (needs the Advanced Security subscription), coverage ≥ 80%, duplication ≤ 3%. [Docs](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/ai-code-assurance/quality-gate-for-agentic-ai.md).
- **Hard CI enforcement** ✅ — `sonar.qualitygate.wait=true` fails the workflow on a red gate; official `sonarqube-quality-gate-action`; PR decoration blocks merges on GitHub, GitLab, Bitbucket, Azure DevOps. [GitHub Actions integration docs](https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/ci-integration/github-actions.md).
- **Pricing** ✅ — SonarQube Cloud: AI Code Assurance, the agentic-AI gate and the cloud MCP server are on **all plans including Free** (public projects unlimited; private up to 50k LOC, 5 members, main branch only); Team from ~$32–34/mo (100k LOC); self-managed Server sold per instance/LOC. [Plans & pricing](https://www.sonarsource.com/plans-and-pricing/).
- **Agent-centric ecosystem** ✅/◐ — the "Agent Centric Development Cycle" (Guide/Generate/Verify/Solve); a free open-source [MCP server](https://github.com/SonarSource/sonarqube-mcp-server) so agents self-verify before opening PRs; a SonarQube CLI for terminal/CI verification (June 2026 ◐); AI CodeFix; Remediation Agent; Advanced Security (SAST+SCA) and Hunter Agent as paid add-ons.
- **Acquired Gitar** on 2026-05-21 ✅ ([Sonar blog](https://www.sonarsource.com/blog/welcoming-gitar-to-sonar), [PR Newswire](https://www.prnewswire.com/news-releases/sonar-acquires-gitar-expanding-code-verification-platform-with-ai-native-code-review-302462926.html)) — Sonar's "CI verification loop" is now deliberately two-layer: deterministic SonarQube analysis decides the merge; Gitar's AI review runs in parallel ✅.

### 4.2 CodeRabbit — the most-adopted independent AI reviewer ✅

- Agentic reviews on every PR + CLI; GitHub, GitLab, Bitbucket, Azure DevOps; 1-click fixes, "learnings" (team memory), custom pre-merge checks, MCP connections ✅. [Pricing](https://www.coderabbit.ai/pricing).
- **Pricing** ✅ (annual billing): Essentials **$24**/dev/mo, Team **$48** (triage, custom checks, unit-test generation), Advanced **$72** (security review of every PR, continuous security monitoring, blast-radius analysis); Enterprise adds self-hosting/EU SaaS; free for OSS; rate limits 5–12 reviews/dev/hour.
- Community sentiment is genuinely split ◐: a GitLab team called it "a great deal ($30/mo/dev flat)" ([HN](https://news.ycombinator.com/item?id=48407013)); a skeptic thread argues there is an "AI code review bubble" and that pointing Claude Code/Copilot at a PR rivals the bots ([HN](https://news.ycombinator.com/item?id=46766961)); one first-hand comparison called Greptile "GPT 3.5-tier … pretty much pure noise" next to CodeRabbit ([HN](https://news.ycombinator.com/item?id=46777079)) — quality judgments in this market are contested and trial-driven.

### 4.3 Greptile — full-codebase-context reviewer ◐

- Indexes the whole repo into a dependency graph; a "swarm" of agents reviews each PR with cross-file context; learns team standards; **TREX** agent writes and runs ephemeral tests in a sandbox to validate findings. [Site](https://greptile.com).
- Pricing: Pro **$30/seat/mo** incl. 50 credits (1 credit = standard review, 3 = TREX; extra $1/credit); free for qualified OSS; self-hosted/air-gapped options. Official pricing page is JS-rendered — the per-seat figure is third-party ◐.
- Third-party benchmarks credit it with the highest cross-file bug recall (~82% ◐) at the cost of more false positives; community noise complaints coexist with recall claims ◐.

### 4.4 Gitar — now Sonar's agentic review layer ✅

- You remembered the name correctly; the domain is **gitar.ai** (not gitar.dev). AI review agent that doesn't just comment: it **commits fixes and iterates "until PR is green"**, diagnoses and dedupes CI failures, detects/retries flaky tests, and runs natural-language CI workflow agents (policy checks, summaries, lint rules). [Site](https://gitar.ai).
- **Pricing** ✅: Core **$20**/user/mo, Pro **$40** (adds auto-approve & merge blocking), Enterprise outcome-based per-PR; free for OSS; 14-day trial. CI failure analysis covers GitHub Actions + GitLab on Core; CircleCI/Buildkite/Bitrise on Pro ✅. Sold by Sonar at $20/user/mo on the Team plan ✅ ([Sonar pricing](https://www.sonarsource.com/plans-and-pricing/)).
- Emerged from stealth with a $9M seed (April 2026 ◐, secondary sources only); acquired by Sonar 2026-05-21 ✅.

### 4.5 Gemini (Google) — yes, it existed; paid enterprise continues, free paths remain ✅/◐

- **Gemini Code Assist for GitHub**: a GitHub App that is auto-assigned as reviewer on every PR — summaries, inline reviews, ready-to-commit suggestions, `/gemini` commands ✅ ([Google Cloud docs](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code), [2025 announcement](https://cloud.google.com/blog/products/ai-machine-learning/gemini-code-assist-and-github-ai-code-reviews)). Enterprise version labeled Preview, quota 100+ PRs/day ✅. A notable built-in guardrail: it **deliberately refuses to review `.github/workflows` files** to avoid injecting insecure CI config ✅.
- **The free consumer app was shut down on 2026-07-17** (new org installs blocked from 2026-06-18) ◐ per Google's [deprecation notice](https://developers.google.com/gemini-code-assist/docs/deprecations/consumer-code-review); as of Sept 2026 the app is gated to Google Cloud customers with paid editions only: Standard $22.80/user/mo monthly ($19 annual), Enterprise $54 ($45 annual) ✅ ([pricing](https://cloud.google.com/products/gemini/code-assist)).
- **The free path**: open-source `gemini-cli` + the official [`run-gemini-cli` GitHub Action](https://github.com/google-github-actions/run-gemini-cli) (beta, Aug 2025) with prebuilt PR-review and issue-triage workflows ✅, plus the official [code-review extension](https://github.com/gemini-cli-extensions/code-review) (`/code-review`, `/pr-code-review`) ◐.
- **Cautionary tale** ✅: CVE-2026-12537 (CVSS 10.0) in `run-gemini-cli` < 0.1.22 — a prompt injection planted in a public GitHub issue could reach CI secrets via a crafted `.gemini/.env`; fixed April 2026 ([GHSA](https://github.com/advisories/GHSA-jj69-4grx-fqj5)). Google's own hardening guidance: pin action versions, Workload Identity Federation instead of API keys, least-privilege app identity, command allowlisting ✅.
- Jules is a PR _producer_ (async coding agent), not a reviewer; Firebase Studio sunsets 2027-03-22 ✅.

### 4.6 Wiz — a security gate, not an AI reviewer; enterprise-only ✅

- Verdict on your recollection: Wiz **is** a realistic CI guardrail, but for _security scanning_ in enterprise pipelines — it is not a per-repo AI code-review bot like CodeRabbit/Greptile ✅.
- CNAPP vendor; **acquired by Google, closed 2026-03-11, $32B** (EU clearance 2026-02-10) ✅ ([Google press corner](https://www.googlecloudpresscorner.com/2026-03-11-Google-Completes-Acquisition-of-Wiz), [Reuters](https://www.reuters.com/world/google-secures-eu-antitrust-approval-32-billion-wiz-acquisition-2026-02-10)).
- **Wiz Code** (GA 2024-09-10) ✅: SCA/SBOM, secrets detection, IaC scanning, CI/CD posture management, one-click fix PRs — correlated to cloud context via the Security Graph. **Wiz SAST** launched 2025-12-02 ✅. On 2026-07-30 Wiz announced a three-tier "agentic code security system" ✅: rule-based SAST (GA, blocks insecure patterns/secrets pre-merge) → AI SAST on every PR (private preview) → agentic pentesting via Wiz Red Agent (GA).
- CI integration is real but platform-shaped ✅: PR scanning, build gates that "automatically break builds if critical security violations are detected", Wiz CLI in pipelines, an MCP server so agents pull scan results into their own context, and the [`wiz-sensor-github-action`](https://github.com/wiz-sec-public/wiz-sensor-github-action) ◐.
- **Pricing**: custom quote only; no self-serve or per-repo tier ✅ — most natural if you already run (or plan) a CNAPP. SonarQube findings can be integrated into Wiz ◐ — the two names you remembered are complementary, not competing.
- The accessible piece for any team: Wiz open-sourced [secure rules files](https://github.com/wiz-sec-public/secure-rules-files) for Claude Code (`CLAUDE.md`), Cursor, Copilot, Codex (`AGENTS.md`), Windsurf, Cline and Aider that steer agents toward secure code at prompt time ✅.

---

## 5. Tool landscape

### 5.1 AI PR reviewers (Layer 3)

| Tool                                 | CI platforms                                                 | Pricing (Sep 2026)                                                       | Notes                                                                                          |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **CodeRabbit** ✅                    | GitHub, GitLab, Bitbucket, Azure DevOps, CLI                 | $24/$48/$72 per dev/mo (annual); free OSS                                | Most-adopted independent; Advanced tier adds per-PR security review                            |
| **Greptile** ◐                       | GitHub, GitLab (+20 claimed)                                 | ~$30/seat/mo + credits; free OSS                                         | Full-codebase context; TREX test-writing agent; recall vs noise debated                        |
| **Gitar (Sonar)** ✅                 | GitHub, GitLab (+Bitbucket/Azure DevOps)                     | $20/$40 per user/mo; free OSS                                            | Commits fixes until CI green; CI failure diagnosis; flaky-test handling                        |
| **Copilot code review** ✅/◐         | GitHub-native (+Azure DevOps preview)                        | Included in paid Copilot plans; ~$0.05–$5 AI credits per review          | Auto-review per repo/org; **can approve PRs since 2026-09-01 (off by default)** ✗              |
| **Gemini Code Assist for GitHub** ✅ | GitHub App                                                   | Standard $19–22.80, Enterprise $45–54 per user/mo                        | Google-Cloud-customer-gated; consumer free tier shut down 2026-07-17 ◐                         |
| **OpenAI Codex review** ◐            | GitHub (Codex cloud connection)                              | Included with paid ChatGPT plans                                         | Auto-review toggle, `@codex review`, `@codex security review` (preview); rules via `AGENTS.md` |
| **Qodo / PR-Agent** ✅               | GitHub Actions, GitLab, Bitbucket, Azure DevOps, Docker, CLI | PR-Agent OSS (community-run since Apr 2026); Qodo Merge commercial       | The self-hostable option; `/review`, `/improve`, `/describe`                                   |
| **Cursor Bugbot** ◐                  | GitHub, GitLab                                               | Usage-based ~$1–1.50/review                                              | Moved off flat $40/user pricing in 2026 (HN complaints)                                        |
| **Bito** ◐                           | GitHub (+GitLab/Bitbucket)                                   | ~$12–20/user/mo                                                          | Frequent budget pick in roundups                                                               |
| **Cubic** ◐                          | GitHub-first, `cubic.yaml` in-repo                           | ~$30/dev/mo                                                              | Custom security rules; zero-retention pitch                                                    |
| **Korbit** ◐                         | GitHub                                                       | ~$12–18/user/mo                                                          | Affordable CodeRabbit alternative                                                              |
| **Amazon Q Developer** ◐             | GitHub App                                                   | Free during preview                                                      | Auto-review on PR create/reopen + rule-based detectors; IDE plugins EOL 2027-04-30 → Kiro      |
| **GitLab Duo Code Review** ◐         | GitLab-native                                                | Premium/Ultimate + Duo Enterprise; per-review credits (price unverified) | GA self-hosted 18.4; group-level auto-review; manual non-agentic mode                          |
| **Rovo Dev (Atlassian)** ◐           | Bitbucket, GitHub                                            | Rovo credits; Jira-criteria checks need Standard plan                    | Verifies PRs against Jira acceptance criteria                                                  |

> Adjacent names flagged by the completeness critique but not covered in depth: Aikido Security, DeepSource, Bearer, JetBrains Qodana, Cognition Devin Review, Ellipsis, Sourcery, CodeAnt, Trag, Devlo, Kodus, Panto, mrge/Graphite. The long tail re-prices and re-brands fast — re-trial rather than fix a shortlist.

### 5.2 Deterministic quality gates (Layer 1)

- **SonarQube Server/Cloud** — see §4.1; the flagship "gate for AI code" ✅.
- **Mutation testing** — Stryker (JS/TS/.NET), mutmut (Python), PIT (Java): the community's answer to hollow AI-generated tests; run diff-scoped to keep CI time sane ◐ ([guide](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code)).
- **GitHub Code Quality** ◐ — CodeQL rules-based findings + per-PR coverage metrics + optional ruleset merge gating, native to GitHub.
- Plain test/typecheck/lint jobs as required status checks remain the base layer everything else assumes.

### 5.3 Security scanning gates (Layer 2)

| Tool                                                | Role                                                                                                                                                                                                                    | License/pricing                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **GitHub CodeQL + secret scanning + Dependabot** ✅ | SAST, push protection, dependency alerts — **free on public repos**; private needs Code Security/Secret Protection add-ons (Team/Enterprise)                                                                            | [GHAS docs](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security) |
| **Semgrep** ✅                                      | Rules-as-code SAST, 30+ languages; OSS engine limited to single function/file; cross-file + Assistant are commercial; MCP server folded into the binary                                                                 | LGPL-2.1 OSS + commercial                                                                                |
| **Snyk Code (DeepCode AI)** ✅                      | AI-powered SAST + SCA/IaC/containers; free tier 5 projects/100 tests-mo; Team $25/mo ≤10 devs; Enterprise credits                                                                                                       | [Pricing](https://snyk.io/plans/)                                                                        |
| **Socket** ✅                                       | Malicious-package firewall; 70+ risk types; GitHub Actions workflow documented; MCP + AI-agent integrations; the named slopsquatting defense                                                                            | Free 1k scans/mo; Team $25/dev/mo; Business $50                                                          |
| **Endor Labs (AURI)** ◐                             | Reachability SCA + **AI Coding Agent Governance** (agent/MCP/skill visibility, dangerous-command blocking, Package Firewall)                                                                                            | Quote-based                                                                                              |
| **Gitleaks** ✅                                     | Secret scanning, MIT, feature-complete (successor project "Betterleaks" announced)                                                                                                                                      | Free                                                                                                     |
| **TruffleHog** ✅                                   | 800+ secret types with _live verification_ (AWS GetCallerIdentity etc.); exit 183 on live creds                                                                                                                         | AGPL-3 OSS + commercial                                                                                  |
| **zizmor** ✅                                       | Static audit of GitHub Actions/Dependabot/pre-commit configs: template injection, over-permission, credential persistence; official action uploads SARIF (enforce via rulesets — it deliberately does not fail the job) | MIT, free                                                                                                |
| **OSV-Scanner** ✅                                  | Lockfile/container/license scanning vs OSV.dev                                                                                                                                                                          | Apache-2.0, free                                                                                         |
| **Renovate / Dependabot updates** ◐                 | Keep dependency PRs flowing so agents' vendored pins don't rot                                                                                                                                                          | Free/AGPL core                                                                                           |

### 5.4 Platform-native agent governance (Layers 4–5)

- **GitHub Copilot coding agent** ◐ — disabled by default; enterprise policy > org; selected-repo allowlists; pushes only to PR branches (never default); workflows on its PRs need write-access approval; signed commits co-authored by the initiating human; default-on firewall; secrets scoped to a `copilot` environment.
- **GitHub Agent HQ** ◐ — control plane (announced 2025-10-28) for multi-vendor agents (Claude, Codex, Jules, Copilot, Cognition, xAI): security policies, audit logging, agent allow/deny, model access.
- **GitLab approval settings** ◐ — the actual anti-self-approval guardrails: prevent approval by MR creator, prevent approvals by users who add commits, remove approvals on new commits, optional re-auth to approve, lockable at group level.
- **Copilot approvals** ✗/✅ — public preview since 2026-09-01: when enabled at repo/org/enterprise level, Copilot's approval satisfies required-approval rules (dismissed on new pushes). Teams that want human-only approval must simply not enable it — but should know the default is _not-counting_, and the option now exists.

### 5.5 Agent containment (Layer 5)

- **Claude Code** ◐ — headless `claude -p` with `--allowedTools` allowlists; deterministic hooks ("must always pass", vs advisory `CLAUDE.md`); sandboxed Bash (Seatbelt on macOS, bubblewrap+seccomp on Linux); adversarial fresh-context review step before work counts as done ([best practices](https://code.claude.com/docs/en/best-practices), [sandboxing](https://code.claude.com/docs/en/sandboxing)).
- **anthropics/claude-code-security-review** ◐ — MIT Action running a security review over PR diffs; documentation explicitly warns it "is not hardened against prompt injection" — review trusted PRs only.
- **OpenAI Codex** ◐ — `codex exec` with `--sandbox read-only|workspace-write|danger-full-access`; `codex-action@v1` defaults to dropping sudo and gating which users/bots can trigger it; cloud runs disable internet by default, proxy egress, strip secrets before the agent phase.
- **Wiz secure-rules-files** ✅ — prompt-level secure-coding rules for CLAUDE.md/AGENTS.md/Cursor/Copilot/etc.
- **[awesome-agent-sandbox](https://github.com/fishman/awesome-agent-sandbox)** ◐ — curated catalog of microVM/container/process sandboxes for agents.

### 5.6 Supply-chain & artifact integrity (Layer 2, extended)

- **GitHub artifact attestations** ◐ — in-toto/SLSA v1.0 provenance signed with short-lived Sigstore certs; free on public repos; verify with `gh attestation verify`.
- **slsa-github-generator** ◐ — isolated reusable workflows qualifying for SLSA Build L3.
- **Action pinning + zizmor** ◐/✅ — SHA-pinning third-party actions (the only immutable option per GitHub docs) and auditing workflows for injection.
- **gitsign / git-sign** ◐ — keyless signed commits (watch CVE-2026-44310, fixed in 0.15/0.16) and an Action that squashes-and-signs agent PRs so they pass `require-signed-commits` protection.
- **Kyverno verifyImages / Sigstore policy-controller** ◐ — deploy-time enforcement that only signed, attested artifacts run.
- **FOSSA** ◐ — license/IP gate; official position: treat generative-AI output like any open-source intake and scan it. Regulatory tailwind: EU AI Act (2024/1689, phased 2025–2027), ISO/IEC 42001, NIST AI RMF ◐.

---

## 6. Recommended stacks by team profile

### Baseline (any repo, ~zero cost)

1. Branch protection: required status checks (test/typecheck/lint), required human review, no direct pushes to default branch.
2. CODEOWNERS routing sensitive paths to humans.
3. On GitHub public repos: enable CodeQL, secret scanning + push protection, Dependabot — free ✅.
4. Add CI jobs: `gitleaks` (or TruffleHog), `zizmor` over your own workflows, `osv-scanner`; pin third-party actions by SHA.
5. One AI reviewer: Copilot review if you already pay for Copilot; otherwise self-hosted **PR-Agent** or the **gemini-cli code-review extension** (BYO model, free).
6. If agents run in CI: headless mode + tool allowlists + hooks; minimal secrets in the runner; run the agent as the _last_ step so later steps don't inherit mutated state.

### Small/mid team, paid

1. Everything above, plus
2. **SonarQube Cloud** (AI Code Assurance works on the free tier for public repos; Team from ~$32/mo) with `sonar.qualitygate.wait=true` and PR decoration ✅.
3. One commercial AI reviewer — trial **CodeRabbit** (broadest platform support), **Greptile** (cross-file recall) or **Gitar** (fix-until-green + CI failure triage) for 2–4 weeks each; sentiment is split, so decide on your own repo ◐.
4. **Socket** Team for the slopsquatting/malicious-package gap (free tier: 1k scans/mo) ✅.
5. Diff-scoped mutation testing if AI writes most of your tests ◐.

### Enterprise

1. Platform-native governance first: Copilot cloud-agent policies / Agent HQ (or GitLab approval settings + Duo), org-level required checks, signed commits.
2. **SonarQube Server/Cloud + Gitar** as the deterministic + agentic pair ✅.
3. **Wiz Code** if you run a CNAPP (code-to-cloud correlation; Google-owned since 2026-03) ✅ — or **Snyk**/**Endor Labs** for appsec-platform-shaped alternatives; Endor AURI if you need agent-behavior governance ◐.
4. Artifact attestations + SLSA provenance + Kyverno/policy-controller admission control; FOSSA-style license gates; EU AI Act/ISO 42001 evidence trails ◐.

---

## 7. What could not be verified (honest gaps)

- **Pricing is systematically third-party** for: Greptile (~~$30/seat), Cursor Bugbot (~$1–1.50/review), GitLab Duo per-review credits (~~$0.25 claim), GHAS per-committer, Wiz, Endor Labs, Gemini paid tiers (figures came from the pricing page but tier availability shifted mid-2026).
- **No independent benchmark of AI reviewer bots exists**; effectiveness claims (Greptile recall vs noise) are conflicting anecdotes.
- **Clinejection** (prompt injection via GitHub issue title → CI compromise, Feb 2026) rests on secondary writeups only — primary disclosure not located.
- Sonar's own quantified AI-code research could not be located (the duplication stat circulating is GitClear's); SonarQube **Server** edition matrix for AI Code Assurance (launch said Enterprise 10.7+) not re-confirmed against current docs.
- HN/Reddit sentiment was sampled from excerpts, not full threads; G2/PeerSpot reviews not deeply read.
- DORA 2025 stability findings were flagged by the critique as relevant justification but were not researched in this pass.
- One verification vote (batch 3, community lens) ran without the safety-classifier check due to rate limiting; treat batch-3 community corroboration with normal skepticism.

---

## 8. Methodology

- 21 subagents on the `sonnet` model: 7 parallel search angles (AI-native reviewers; Sonar; Google/Gemini; Wiz; security scanning; platform-native; community practices), each searching the web and reading primary sources; then 3-vote adversarial verification of the 45 unique high-importance claims (lenses: primary source, independent corroboration, freshness/drift — 2/3 votes decide); then a completeness critic plus one gap-fill researcher (Codex, agent governance, supply-chain integrity, license/regulatory).
- 84 claims collected; 45 verified: **43 confirmed, 2 refuted** (both refutations were partial corrections — the Copilot "comment-only" assumption and the Sonar announcement date — both incorporated above); 20 high claims over the verification cap plus 19 medium/low claims remain single-source (marked ◐).
- Tool uses: 798 web searches/fetches. Full angle gaps and per-claim evidence are preserved in the workflow journal.

## 9. Sources (selection)

Vendor/primary: [Sonar AI Code Assurance](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/ai-code-assurance/overview.md) · [Sonar agentic-AI quality gate](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/ai-code-assurance/quality-gate-for-agentic-ai.md) · [Sonar plans](https://www.sonarsource.com/plans-and-pricing/) · [Sonar acquires Gitar](https://www.sonarsource.com/blog/welcoming-gitar-to-sonar) · [Gitar pricing](https://gitar.ai/pricing) · [CodeRabbit pricing](https://www.coderabbit.ai/pricing) · [Greptile](https://greptile.com) · [Gemini Code Assist code review docs](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code) · [Gemini consumer deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/consumer-code-review) · [run-gemini-cli](https://github.com/google-github-actions/run-gemini-cli) · [GHSA-jj69-4grx-fqj5](https://github.com/advisories/GHSA-jj69-4grx-fqj5) · [Google completes Wiz acquisition](https://www.googlecloudpresscorner.com/2026-03-11-Google-Completes-Acquisition-of-Wiz) · [Wiz Code](https://www.wiz.io/blog/introducing-wiz-code) · [Wiz SAST](https://www.wiz.io/blog/introducing-wiz-sast-where-code-risk-meets-cloud-context) · [Wiz agentic code security](https://www.wiz.io/blog/agentic-code-security) · [Wiz secure-rules-files](https://github.com/wiz-sec-public/secure-rules-files) · [Copilot code review docs](https://docs.github.com/en/copilot/concepts/agents/code-review) · [Copilot approvals changelog](https://github.blog/changelog/2026-09-01-copilot-code-review-can-now-approve-pull-requests) · [Copilot coding agent responsible use](https://docs.github.com/copilot/responsible-use/copilot-coding-agent) · [GHAS](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security) · [GitLab 18.4 release](https://docs.gitlab.com/releases/18/gitlab-18-4-released/) · [GitLab approval settings](https://docs.gitlab.com/ee/user/project/merge_requests/approvals/settings.html) · [Amazon Q code reviews](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/code_reviews.html) · [Qodo hands PR-Agent to community](https://www.qodo.ai/blog/qodo-is-handing-pr-agent-over-to-the-community) · [Socket pricing](https://socket.dev/pricing) / [Socket for GitHub Actions](https://docs.socket.dev/docs/socket-for-github-actions) · [Snyk pricing](https://snyk.io/plans/) · [Semgrep](https://github.com/semgrep/semgrep) · [Gitleaks](https://github.com/gitleaks/gitleaks) · [TruffleHog](https://github.com/trufflesecurity/trufflehog) · [zizmor](https://github.com/zizmorcore/zizmor) · [Claude Code best practices](https://code.claude.com/docs/en/best-practices) / [sandboxing](https://code.claude.com/docs/en/sandboxing) · [claude-code-security-review](https://github.com/anthropics/claude-code-security-review) · [Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/) · [Endor Labs agent security](https://www.endorlabs.com/learn/introducing-security-for-ai-coding-agents-and-workstations).

Research/evidence: [Veracode 2025 GenAI Code Security Report](https://www.veracode.com/blog/ai-generated-code-security-risks) · [Spracklen et al., USENIX 2025 (arXiv 2406.10279)](https://arxiv.org/abs/2406.10279) · [Socket on slopsquatting](https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks).

Community: [HN: CodeRabbit pricing](https://news.ycombinator.com/item?id=48407013) · [HN: AI code review bubble](https://news.ycombinator.com/item?id=46766961) · [HN: Greptile vs CodeRabbit](https://news.ycombinator.com/item?id=46777079) · [Factory: reviewing agent-generated PRs](https://factory.com/articles/reviewing-agent-generated-pull-requests) · [mutation testing for AI code](https://www.augmentcode.com/guides/mutation-testing-ai-generated-code) · [awesome-agent-sandbox](https://github.com/fishman/awesome-agent-sandbox).
