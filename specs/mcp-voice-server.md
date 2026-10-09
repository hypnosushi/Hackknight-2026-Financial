# MCP Server & Voice

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

The brainstorm wants an agent-friendly interface into this system (MCP server)
and an audio/voice interaction mode (voice -> text -> action), e.g. setting up
standing alerts by speaking a request.

## Goals

- Expose an MCP server surfacing this system's core actions (search, set alert,
  check signals) as tools an agent/LLM client can call.
- Support a voice -> text -> action flow for at least one action (e.g. "keep an
  alert on X").

## Non-Goals

- A full custom voice assistant product — scoped to a thin voice front-end over
  the MCP tools for MVP.
- Every feature exposed via MCP on day one — start with search and alerts.

## User Stories / Example Interactions

- As a user, I say "keep an alert on Nvidia" and the system transcribes it,
  extracts the intent, and calls the alert-creation action from
  [[alerts-pubsub]].
- As an agent/LLM client, I connect to the MCP server and call a `search` tool
  backed by [[search-rag]].

## Functional Requirements

1. Stand up an MCP server exposing at minimum: `search`, `create_alert`,
   `get_recent_signals` as tools.
2. Each tool delegates to the corresponding feature's existing interface
   ([[search-rag]], [[alerts-pubsub]], [[classifier-signal-detection]]) rather
   than reimplementing logic.
3. Add a voice front-end: audio -> text (STT) -> parsed intent -> MCP tool call.

## Design / Approach

Left light. The MCP server is mostly a thin adapter layer over existing
feature interfaces; voice adds an STT step and basic intent parsing in front of
it.

## Interfaces / Data Model

MCP tools (draft):

```
search(query: str) -> SearchResult        # delegates to search-rag
create_alert(entity: str, condition?) -> subscription_id   # delegates to alerts-pubsub
get_recent_signals(entity: str) -> Signal[]  # delegates to classifier-signal-detection
```

## Dependencies

- [[search-rag]], [[alerts-pubsub]], [[classifier-signal-detection]] — the
  features being exposed as MCP tools.
- An STT provider for the voice front-end (not yet chosen).

## Open Questions

- Which STT provider/library for the voice piece?
- How is voice intent parsed into a specific tool call — simple keyword
  matching, or an LLM-based intent parser?
- Full MCP tool surface — confirm `search` / `create_alert` /
  `get_recent_signals` is the right MVP set.

## Acceptance Criteria

- An MCP client can call `search` and get a real result from [[search-rag]]
  during a demo.
- At least one voice -> text -> action flow (e.g. creating an alert) works
  end-to-end in a demo.
