# Jev Classifier

**Status:** Draft
**Owner:** Unassigned

## Problem / Why

Raw news/Twitter items aren't directly useful until something judges what
they mean for a given company or question. The Jev Classifier labels each
incoming content item against a set of questions — either simple
positive/negative sentiment, or questions the user defines — so downstream
features ([[trending-cards]], [[news-graphing]], [[company-network]]) work
with judged signal instead of raw text.

This is a narrower role than the old `specs/jev-classification.md`'s
six-use-case design (guardrail, routing, actionability gate, etc.) — none of
that is carried forward here. Only question-based classification is in
scope for this direction.

## Goals

- Classify each content item from [[ingestion/news-aggregator]] and
  [[ingestion/twitter-aggregator]] against a configurable set of questions.
- Support a simple default mode (positive/negative sentiment) for when no
  custom questions are defined.
- Support user-defined questions (e.g. "does this article suggest NVDA
  earnings will beat expectations?").

## Non-Goals

- Guardrail/dedup/routing logic (duplicate detection, block reasons,
  agent routing) — not part of this direction.
- Building/maintaining the company relationship graph — that's
  [[company-network]].

## User Stories / Example Interactions

- As a user, I want a quick positive/negative read on a news item without
  defining anything myself.
- As a user, I want to ask a custom question (e.g. "is this bullish for
  semiconductors?") and have every matching item classified against it.
- As the system, when an item is classified, I want that result available
  to [[trending-cards]] and [[news-graphing]] so they can surface it.

## Functional Requirements

1. Accept a content item (from [[ingestion/news-aggregator]] or
   [[ingestion/twitter-aggregator]]) and a set of questions to classify it
   against.
2. Default to simple positive/negative sentiment when no custom questions
   are configured.
3. Support user-defined questions, each producing its own classification
   result per item.
4. Attach classification results to the item (or a linked record) so
   downstream features can read them without re-running classification.

## Design / Approach

Left light. Model choice unconfirmed — the project is still called "Jev"
per the source doc but which model/API backs it is undecided.

## Interfaces / Data Model

Draft shape (not final):

```
{
  "item_id": "<content item id>",
  "question": "<default: positive/negative | user-defined text>",
  "result": "<classification output — exact shape TBD, e.g. positive/negative, or a score>"
}
```

## Dependencies

- [[ingestion/news-aggregator]] and [[ingestion/twitter-aggregator]] —
  upstream content sources.
- [[trending-cards]] and [[news-graphing]] — consumers of classification
  results.

## Open Questions

- What model/API backs classification?
- Exact output shape per question — binary, score, free text?
- Can a user define questions at query time, or only ahead of time as
  configuration?
- Does this layer also do entity/ticker extraction, or is that fully owned
  by the aggregators (see [ingestion overview](./ingestion/README.md))?

## Acceptance Criteria

- A manufactured positive-sentiment item and a manufactured negative-sentiment
  item are classified correctly under the default mode.
- A manufactured item is correctly classified against at least one
  user-defined question.
