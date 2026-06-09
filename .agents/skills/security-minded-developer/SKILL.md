---
name: security-minded-developer
description: "Use when implementing or reviewing React or Node code that touches authentication, authorization, API endpoints, forms, file uploads, secrets, user data, or any flow where insecure code could create vulnerabilities or data exposure. Helps the agent apply secure defaults, validate and sanitize inputs, enforce permission checks, avoid leaking sensitive data, and prefer safer implementations over convenient but risky ones."
---

# Security-Minded Developer

## Purpose

Use this skill when working on frontend or backend code that could introduce security risks if implemented carelessly.

This skill makes the agent apply secure defaults and actively look for common vulnerability patterns before writing or changing code.

## Use This Skill When

- Creating or updating API endpoints
- Handling authentication or authorization
- Working with forms and user-submitted input
- Processing uploaded files
- Storing, reading, or returning sensitive data
- Integrating third-party APIs or webhooks
- Working with tokens, sessions, cookies, or credentials
- Reviewing code for security weaknesses
- Creating database models that include sensitive fields or access patterns

## Do Not Use This Skill When

- Making a purely visual UI change with no data or permission impact
- Editing static content with no security relevance
- Working on code paths that do not process user input, permissions, secrets, or sensitive data

## Behavior

When this skill is active, follow these rules:

1. Treat all external input as untrusted.
2. Validate and sanitize request data where appropriate.
3. Enforce authentication and authorization on the backend, not just in the UI.
4. Do not trust client-side checks for security decisions.
5. Avoid leaking secrets, internal implementation details, or sensitive data in logs, responses, or errors.
6. Use least-privilege thinking when deciding access.
7. Prefer secure defaults when multiple implementation choices exist.
8. Check for common risks such as broken access control, injection, unsafe file handling, insecure direct object references, weak token handling, and overly verbose error responses.
9. Keep secret values out of source code and out of frontend bundles.
10. Make security part of the implementation, not an afterthought.
11. Encrypt sensitive data at rest and in transit when possible, but do not rely on encryption alone to protect data if other vulnerabilities exist.

## Workflow

### 1. Identify the Risk Surface

Check whether the task touches:

- request bodies
- query params
- route params
- headers
- cookies
- tokens
- sessions
- file uploads
- user records
- roles and permissions
- secrets
- third-party payloads
- database values that contain sensitive data

### 2. Validate Inputs

Before processing external data:

- validate required fields
- validate types and allowed values
- reject malformed input
- sanitize only where needed and appropriate
- avoid passing raw untrusted input into sensitive operations

### 3. Enforce Access Control

Before returning data or performing actions:

- verify the user is authenticated when required
- verify the user is authorized for the specific action
- verify ownership or role requirements on the backend
- avoid assuming the frontend already enforced access

### 4. Protect Sensitive Data

When handling responses, storage, logs, and errors:

- do not expose secrets
- do not return unnecessary sensitive fields
- do not leak internal stack or infrastructure details
- keep logs useful without making them dangerous
- encrypt sensitive data at rest and in transit when possible

### 5. Verify the Safer Path

Before finalizing:

- check whether the implementation trusts user input too much
- check whether access rules are enforced server-side
- check whether sensitive data is overexposed
- check whether the chosen implementation increases attack surface unnecessarily

## Frontend Expectations

In React code:

- do not rely on hidden UI alone to protect sensitive actions
- do not expose secret configuration in the client
- handle auth-related state carefully
- avoid unsafe rendering of untrusted content
- treat client-side checks as UX, not security enforcement

## Backend Expectations

In Node code:

- validate all incoming input
- enforce authorization explicitly
- use safe error responses
- protect file handling paths
- avoid insecure direct access to records without ownership checks
- keep privileged operations behind clear rules
- encrypt sensitive data and secrets at rest and in transit, but do not rely on encryption alone

## Output Expectations

Good outcomes from this skill look like:

- validated input paths
- explicit permission checks
- minimal exposure of sensitive data
- safer defaults in auth and API behavior
- code that reduces the chance of common vulnerabilities

## Anti-Patterns

Avoid these mistakes:

- trusting client-provided role or ownership data
- checking authorization only in the UI
- returning full objects when only a few fields are needed
- logging secrets or tokens
- exposing raw backend errors to clients
- processing uploaded files without validation
- assuming authenticated automatically means authorized

## Final Rule

If a choice is convenient but increases security risk, do not choose it. Use the safer implementation.
