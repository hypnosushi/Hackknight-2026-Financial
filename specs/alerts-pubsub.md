# Alerts (Pub/Sub)

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Users shouldn't have to keep checking the feed — when something they care about
happens (a spike, a whale trade, a tracked relationship signal), they should be
notified. The brainstorm flags this as a good fit for a pub/sub pattern.

## Goals

- Let users subscribe to alerts for an entity/ticker or a condition (e.g.
  "notify me on a whale trade for X").
- Deliver notifications when [[classifier-signal-detection]] flags a matching
  signal, or when an ingestion source emits a flagged event (e.g. whale trade
  from [[ingestion/polymarket|Polymarket]]).

## Non-Goals

- Rich notification channels beyond MVP (push notifications, email digests,
  etc.) — start with the simplest viable channel (in-app / webhook / console)
  for the demo.
- Complex alert-condition DSL — start with simple entity + threshold matching.

## User Stories / Example Interactions

- As a user, I want to set an alert on NVDA so I'm notified the moment a spike
  or whale trade involving it is detected.
- As the system, when a new signal is published, I want every matching
  subscriber notified without polling.

## Functional Requirements

1. Let a user register an alert subscription (entity + optional condition).
2. Subscribe to the signal/event stream (likely Redis pub/sub, per
   [[redis-cache-storage]]) and match incoming signals against active
   subscriptions.
3. Deliver a notification per match through whatever channel is chosen for MVP.
4. (Stretch) Let [[mcp-voice-server]] both create and read back alerts via
   voice.

## Design / Approach

Left light. Likely: [[classifier-signal-detection]] (and flagged ingestion
events) publish onto a Redis pub/sub channel; this service subscribes, matches
against stored subscriptions, and fires notifications.

## Interfaces / Data Model

```
subscribe(user_id, entity, condition?) -> subscription_id
# on matching signal:
notify(user_id, signal) -> <delivered via chosen channel>
```

## Dependencies

- [[redis-cache-storage]] — likely transport (pub/sub) and subscription storage.
- [[classifier-signal-detection]] — publisher of most alert-triggering signals.
- [[ingestion/polymarket|Polymarket ingestion]] — whale trades are a direct
  alert trigger, not only via the classifier.

## Open Questions

- What's the MVP delivery channel — console/log output for the demo, a simple
  webhook, something else?
- Per-user subscription storage — in Redis, or a separate lightweight store?

## Acceptance Criteria

- A manufactured signal for a subscribed entity results in a visible
  notification during a demo.
