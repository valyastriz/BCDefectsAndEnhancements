---
name: node-api-structure-enforcer
description: "Use when building, updating, or refactoring a Node backend endpoint or service and the work should follow a clean layered structure instead of placing routes, request handling, business logic, validation, and data access into one file or function. Helps the agent keep backend code organized with clear separation between routes, controllers, services, middleware, validation, and persistence logic using js."
---

# Node API Structure Enforcer

## Purpose

Use this skill when working on a Node backend and the implementation should follow a clean API structure with clear separation of responsibilities.

This skill makes the agent organize backend code into the right layers so the code stays readable, maintainable, testable, and easier to extend.

## Use This Skill When

- Creating a new API endpoint
- Updating an existing route or controller
- Refactoring a backend feature that has grown messy
- Moving business logic out of route files
- Splitting validation, request handling, and persistence concerns
- Standardizing backend structure across a feature area

## Do Not Use This Skill When

- Making a tiny one-line backend change in an already well-structured file
- Working on a trivial script that is not part of the API architecture
- Splitting a very small handler would add unnecessary indirection without improving clarity

## Behavior

When this skill is active, follow these rules:

1. Keep routes, controllers, services, middleware, validation, and data access separated by responsibility.
2. Do not place the full request lifecycle into one large route file or one oversized function.
3. Keep route files focused on endpoint wiring.
4. Keep controllers focused on request and response coordination.
5. Keep services focused on business logic.
6. Keep validation explicit and close to the request boundary.
7. Keep middleware reusable and limited to cross-cutting concerns.
8. Keep persistence and database interaction out of route definitions when the project structure supports separation.
9. Reuse existing backend patterns before creating new ones.
10. Use js conventions for backend files.

## Workflow

### 1. Identify the Request Lifecycle

Before writing code, break the backend task into responsibilities such as:

- route registration
- request parsing
- validation
- authentication
- authorization
- controller flow
- business rules
- database access
- third-party service calls
- response formatting
- error handling

### 2. Put Each Responsibility in the Right Layer

Use clear separation:

- **routes** define paths and attach middleware
- **controllers** receive the request and coordinate the response
- **services** handle business logic
- **validation** checks request shape and required values
- **middleware** handles reusable pre-processing or protection
- **data access** handles reads and writes to persistence layers

### 3. Keep Controllers Thin

Controllers should mainly:

- read validated input
- call the appropriate service
- translate the result into a response
- pass errors into the existing error flow

Controllers should not become the place where all domain logic lives.

### 4. Keep Services Focused

Services should contain:

- business rules
- workflow decisions
- orchestration between dependencies
- domain-level operations

Services should not be cluttered with raw HTTP concerns unless the codebase already uses that style.

### 5. Keep Validation at the Boundary

Validate input before business logic runs.

This includes:

- body fields
- params
- query values
- required identifiers
- allowed transitions
- shape and type expectations

### 6. Verify the Structure

Before finalizing:

- check whether route files stayed small
- check whether controllers stayed focused
- check whether business logic was pushed into services
- check whether validation is explicit
- check whether persistence logic is in the right place
- check whether the endpoint matches nearby backend patterns

## Preferred Structure

A backend feature should generally look more like this:

```text
orders/
  routes/
    orderRoutes.js
  controllers/
    orderController.js
  services/
    orderService.js
  validators/
    orderValidator.js
  middleware/
    requireOrderAccess.js
  data/
    orderRepository.js
```
Not like this:
```text
orderRoutes.js
```
with one file containing:

- route definitions
- validation
- auth checks
- business logic
- database queries
- third-party calls
- response formatting
- error handling

## Response and Error Guidance

When implementing endpoints:

- keep response handling consistent with the existing API style
- keep success and failure paths clear
- avoid mixing response formatting with domain logic
- use the project's established error-handling pattern
- do not leak internal details in errors

## Output Expectations

Good outcomes from this skill look like:

- route files that are easy to scan
- controllers that stay small
- services with clear business responsibilities
- explicit validation
- reusable middleware
- backend code that is easier to test and extend

## Anti-Patterns

Avoid these mistakes:

- fat route files
- fat controllers
- database queries directly in route definitions
- validation scattered across multiple layers
- business rules hidden inside middleware
- mixing HTTP concerns with persistence logic everywhere
- creating new backend structure patterns that conflict with the repo

## Final Rule

If a backend file is handling too many parts of the request lifecycle, split the responsibilities into the correct layers before it turns into a maintenance problem.
