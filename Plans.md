# Book API and MCP Server Plans

Created: 2026-08-03

## Planning metadata

- `team_validation_mode: subagent`
- Product/Architecture review: completed
- Security review: completed
- QA/Skeptic review: completed
- `unknown_data: []`
- Spec delta: created `spec.md` as the product contract for the REST/MCP boundary, data model, persistence, tools, and acceptance criteria.
- Pre-approved by the implementation request: create local project files, generate local JSON fixtures, and download the explicitly selected package dependencies. No secrets, destructive operations, deployment, publication, or external service writes are in scope.

## Phase 1: Contract and tooling

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 1.1 | `[lane:gate] [tdd:skip:planning-contract]` Define product spec, project boundaries, API/MCP contracts, safeguards, and verification plan. | `spec.md` and this v2 task ledger contain testable, mutually consistent contracts and independent review evidence. | - | cc:完了 |

## Phase 2: Implementation

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 2.1 | `[lane:gate] [tdd:required]` Build `book-api` with Bun/Elysia, deterministic 10k preset JSON, CRUD, rich queries, derived endpoints, and atomic file persistence. | `book-api` has exactly 10k validated preset records and passes unit/integration tests plus TypeScript checks. | 1.1 | cc:完了 |
| 2.2 | `[lane:gate] [tdd:required]` Build `book-mcp-sv` with `@modelcontextprotocol/sdk`, REST-only tools, stdio and Streamable HTTP entrypoints, and sanitized errors. | `book-mcp-sv` lists and calls all specified tools through HTTP and passes tests plus TypeScript checks. | 1.1 | cc:完了 |

## Phase 3: Integration and closeout

| Task | Content | DoD | Depends | Status |
|---|---|---|---|---|
| 3.1 | `[lane:gate] [tdd:required]` Run cross-project smoke tests, verify runtime instructions, review scope/security, and finalize documentation. | Both projects pass test/typecheck; end-to-end MCP-to-REST smoke succeeds; documentation contains reproducible run and client configuration instructions; review has no critical or major findings. | 2.1, 2.2 | cc:完了 |

## Stage gates

1. Research: official Elysia and MCP SDK documentation checked; independent product, architecture, security, QA, and skeptic perspectives completed.
2. Plan: contracts fixed in `spec.md` and tasks fixed above.
3. Implementation: TDD is required for source tasks.
4. Review: runtime checks and a focused static/security review are required.
5. Closeout: local evidence and usage documentation only; no push, PR, deploy, or release.
