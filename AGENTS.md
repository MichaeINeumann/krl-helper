# AGENTS.md

## Purpose

This file defines the general working rules for coding agents and AI-assisted development in this repository.

The goal is to produce software that is correct, secure, maintainable, understandable, testable, extensible, reviewable, and suitable for professional software-development workflows.

These rules are intended to be reusable across projects. Project-specific instructions may extend them, but should not weaken the safety, privacy, quality, or review requirements defined here.

---

## 1. Protect Confidential and Company Information

Never add confidential, proprietary, customer-specific, employer-specific, or otherwise non-public information to source code, tests, documentation, examples, commit messages, issues, pull requests, release notes, screenshots, fixtures, logs, or generated artifacts.

Do not introduce or retain:

* company names unless explicitly required and approved,
* customer names,
* project numbers,
* machine or plant identifiers,
* employee names,
* internal hostnames,
* IP addresses,
* network paths,
* internal URLs,
* private repository URLs,
* credentials,
* passwords,
* API keys,
* access tokens,
* certificates,
* private keys,
* serial numbers,
* production data,
* customer-specific variable names,
* real production programs,
* confidential comments,
* proprietary documents,
* internal screenshots,
* private file-system paths,
* or information that could reveal internal infrastructure or business processes.

When examples or test data are required, use synthetic and neutral data.

Prefer names such as:

```text
TestMachine
ExampleStation
DemoProject
bPartDetected
nCounter
P_Home
P_TestPoint
```

instead of names copied from real systems.

If it is unclear whether information is public or confidential, treat it as confidential and replace it with synthetic data.

Never commit secrets, even temporarily.

If a secret is discovered in Git history, removing it from the latest commit is not sufficient. The credential must also be revoked or rotated, and the repository history must be cleaned if appropriate.

---

## 2. Respect Copyrights, Trademarks, and Third-Party Rights

Do not copy source code, images, logos, documentation, screenshots, icons, examples, or other protected material from third parties unless the license clearly permits it.

Do not use third-party company logos or branding unless explicitly authorized.

Trademarks and product names may be referenced only when necessary to describe compatibility, interoperability, or the technical purpose of the project.

Do not create branding that could make an independent project appear official, endorsed, sponsored, or maintained by another company.

When relevant, use a clear disclaimer such as:

> This is an independent, unofficial project and is not affiliated with, endorsed by, sponsored by, or maintained by the respective product manufacturer.

Use original or properly licensed graphics and assets.

Before adding a third-party dependency, verify that its license is compatible with the project.

---

## 3. Keep the Repository Public-Safe

Assume that every committed file may eventually become public.

Before committing, check for:

* secrets,
* credentials,
* internal names,
* personal data,
* proprietary files,
* temporary files,
* generated binaries,
* debug logs,
* local configuration,
* editor-specific state,
* backup files,
* test exports,
* and accidental copies of external projects.

Use `.gitignore` and packaging ignore files appropriately.

Generated build artifacts should normally not be committed unless there is a clear project-specific reason.

---

## 4. Clean Code

Write code primarily for humans to understand and maintain.

Prefer:

* clear naming,
* small focused functions,
* explicit control flow,
* low coupling,
* high cohesion,
* simple abstractions,
* predictable behavior,
* and minimal duplication.

Avoid:

* overly clever solutions,
* premature optimization,
* unnecessary abstractions,
* deeply nested logic,
* large multipurpose functions,
* hidden side effects,
* duplicated business logic,
* unexplained magic numbers,
* and dead code.

Follow the language and framework conventions already used in the repository.

Do not refactor unrelated code without a reason.

Keep changes focused on the issue or feature being implemented.

---

## 5. Design for Extension and Maintenance

New code should be easy to extend without rewriting unrelated parts of the system.

Prefer stable interfaces and clearly separated responsibilities.

When introducing a new feature:

1. identify the responsibility,
2. place it in the appropriate module,
3. avoid unnecessary dependencies,
4. expose the smallest useful interface,
5. keep implementation details internal,
6. add tests around public behavior,
7. update documentation where necessary.

Do not design speculative frameworks for hypothetical future requirements.

Create abstractions when they reduce real duplication or improve maintainability.

---

## 6. Comments and Documentation

Code should be understandable through good structure and naming first.

Use comments where they add information that the code itself cannot express clearly.

Good comments explain why something is necessary, unusual constraints, protocol or file-format details, non-obvious edge cases, compatibility decisions, safety assumptions, and reasons for a workaround.

Avoid comments that merely repeat the code.

Public APIs, complex modules, parsers, protocols, algorithms, and non-obvious behavior should have appropriate documentation.

Update documentation whenever behavior changes.

---

## 7. Software Development Workflow

Use a professional Git workflow.

The `main` branch should remain stable and releasable.

Do not develop substantial changes directly on `main`.

Create a dedicated branch for each independent task.

Recommended naming:

```text
feature/<short-description>
fix/<short-description>
refactor/<short-description>
docs/<short-description>
test/<short-description>
chore/<short-description>
```

A branch should normally address one logical concern.

Do not collect unrelated changes in the same branch.

There is no need to be afraid of having many short-lived branches. Branches are cheap and should be used to isolate work.

---

## 8. Pull Requests

Changes intended for `main` should normally go through a Pull Request.

A Pull Request should have a clear title, explain what changed and why, reference the related issue when applicable, describe important design decisions, list relevant tests, mention known limitations, and avoid unrelated changes.

Prefer small and reviewable Pull Requests over very large ones.

The author or coding agent should review the complete diff before requesting merge.

A Pull Request is also useful for solo development because it creates a reviewable history and a natural checkpoint before merging.

Do not merge a Pull Request while known relevant tests are failing.

---

## 9. Issues

Use issues to describe bugs, features, technical debt, documentation work, and planned improvements.

An issue should describe the problem or desired outcome rather than prescribing unnecessary implementation details.

Useful labels may include:

```text
bug
enhancement
documentation
refactor
testing
good first issue
help wanted
```

Never include confidential customer or company data in an issue.

Synthetic examples must be used when reproducing problems.

---

## 10. Tests Are Required

Every meaningful code change should be accompanied by appropriate tests.

New features require tests.

Bug fixes should include a regression test that fails before the fix and passes afterward whenever reasonably possible.

Refactoring should preserve existing tests and add tests if previously untested behavior is touched.

Tests should cover normal behavior, important edge cases, invalid input, error handling, boundary conditions, previously reported bugs, and behavior likely to break during future changes.

Prefer testing externally observable behavior over implementation details.

Do not write meaningless tests merely to increase coverage numbers.

---

## 11. Test Coverage

Maintain strong automated test coverage.

When adding or changing code:

* inspect which paths are affected,
* add tests for the relevant branches and edge cases,
* verify that important behavior is protected against regression.

Coverage should be used as a quality signal, not as the sole measure of test quality.

Where practical, configure CI to run the full test suite and report coverage.

---

## 12. Tests Must Be Reliable

Tests should be deterministic, independent, repeatable, fast enough for regular use, and safe to run on developer machines and in CI.

Avoid unnecessary dependencies on external services, production systems, real credentials, local machine state, network availability, wall-clock timing, or execution order.

Use mocks, fixtures, temporary directories, local test servers, or synthetic data where appropriate.

---

## 13. Validate Before Commit or Pull Request

Before considering a change complete, run the relevant project checks.

Typical checks include:

```text
format
lint
type-check
build
unit tests
integration tests
coverage
package validation
```

Use the project's existing commands when available.

A coding agent must not claim that tests passed unless they were actually executed successfully.

If a test cannot be run, state this clearly.

---

## 14. Do Not Hide Failures

Never disable, delete, weaken, or bypass a failing test merely to make the test suite pass unless the test itself is demonstrably incorrect.

Do not silence compiler errors, suppress warnings without justification, catch and ignore unexpected exceptions, remove validation, reduce security checks, or modify expected results merely to obtain a green build.

Fix the underlying cause.

---

## 15. Backward Compatibility

Consider whether a change affects public APIs, configuration formats, file formats, command names, extension identifiers, serialized data, CLI arguments, network protocols, or user workflows.

Avoid breaking changes unless necessary.

If one is required, document it, explain why, provide a migration path where practical, and use appropriate versioning.

---

## 16. Versioning and Releases

Use Semantic Versioning where appropriate:

```text
MAJOR.MINOR.PATCH
```

Typical interpretation:

* `PATCH`: backward-compatible bug fixes
* `MINOR`: backward-compatible features
* `MAJOR`: incompatible changes

Before a release, ensure the working tree is clean, run tests, verify the version, update the changelog, review the final diff, verify packaged artifacts, merge through the normal workflow, create the release tag, and publish the artifact.

Do not reuse an already published version number.

---

## 17. Commit Quality

Commits should be understandable and logically scoped.

Prefer:

```text
Add project-wide declaration index
Fix line-comment toggle for empty selections
Add regression tests for global declarations
Document contribution workflow
```

Avoid:

```text
changes
fix
stuff
update
test2
final final
```

Do not include confidential information in commit messages.

A commit should ideally leave the repository in a working state.

---

## 18. Cherry-Picking and Parallel Development

Independent changes should remain on independent branches whenever practical.

If one change is needed elsewhere before the original branch can be merged, prefer rebasing, merging an intentional dependency branch, or cherry-picking a small self-contained commit.

Do not duplicate code manually between branches.

Document non-obvious cherry-picks or dependencies.

---

## 19. AI and Coding Agents Are Allowed

AI-assisted development and coding agents are explicitly allowed unless a project-specific rule says otherwise.

AI-generated code must meet the same standards as human-written code.

Using an AI agent does not remove responsibility for correctness, licensing, security, privacy, maintainability, tests, documentation, or review.

Never assume AI-generated code is correct.

Review all generated changes.

Do not allow agents to introduce real confidential data into prompts, test fixtures, comments, issues, or commits.

Agents should prefer synthetic examples.

---

## 20. Agent Scope and Autonomy

Coding agents may inspect the repository, create branches, implement requested changes, add or update tests, update documentation, refactor directly related code, run local checks, and prepare Pull Requests.

Agents should not make unrelated architectural changes, remove major functionality without justification, alter licensing, publish releases without authorization, expose confidential data, rewrite shared Git history without explicit permission, force-push shared branches without explicit permission, or merge their own Pull Request unless the project workflow explicitly allows it.

Destructive operations require explicit authorization.

---

## 21. Dependency Management

Add dependencies only when they provide clear value.

Consider maintenance status, security history, size, transitive dependencies, license, compatibility, and long-term availability.

Avoid adding a large dependency for a trivial task.

Keep dependency versions and lock files consistent.

---

## 22. Security

Treat all external input as potentially invalid.

Apply appropriate validation to user input, files, network data, command arguments, configuration values, and serialized data.

Avoid command injection, path traversal, unsafe deserialization, arbitrary code execution, and insecure temporary-file handling.

Never log secrets.

Use the minimum permissions required.

---

## 23. Error Handling

Errors should be handled deliberately.

Provide useful diagnostics without leaking sensitive information.

Do not silently ignore failures.

Prefer clear error messages explaining what failed and what can be done next.

Preserve original error context when wrapping exceptions.

---

## 24. Performance

Optimize only where performance matters.

Measure before optimizing.

Make focused improvements, verify correctness, measure again, and add benchmarks where appropriate.

Do not sacrifice maintainability for insignificant performance gains.

---

## 25. Documentation and Examples Must Use Synthetic Data

All public documentation, examples, screenshots, test programs, sample configuration, and fixtures must use invented data.

Never anonymize real customer code merely by changing one or two names if the underlying structure can still reveal a real production process.

When in doubt, build a new minimal synthetic example from scratch.

---

## 26. Definition of Done

A task is complete only when:

* implementation is complete,
* code is understandable,
* existing conventions are followed,
* no confidential information was introduced,
* third-party rights were respected,
* appropriate tests were added,
* all relevant tests pass,
* lint/type/build checks pass,
* documentation was updated when required,
* the diff contains no unrelated changes,
* the branch is ready for review,
* and the Pull Request clearly describes the change.

---

## 27. Priority of Instructions

When instructions conflict, use this priority:

1. legal, privacy, security, and confidentiality requirements,
2. repository-specific mandatory instructions,
3. correctness and test requirements,
4. compatibility requirements,
5. maintainability and code-quality requirements,
6. task-specific preferences,
7. stylistic preferences.

Never violate confidentiality, security, licensing, or legal constraints merely to complete a task faster.

---

## 28. General Principle

Prefer a small, correct, well-tested, understandable change over a large clever change.

The desired workflow is:

```text
Issue
  ↓
Dedicated branch
  ↓
Implementation
  ↓
Automated tests
  ↓
Local validation
  ↓
Pull Request
  ↓
Review
  ↓
Merge into main
  ↓
Version / tag
  ↓
Release
```

Keep `main` stable, keep changes reviewable, keep public repositories free of confidential information, and leave the codebase easier to understand than it was before.
