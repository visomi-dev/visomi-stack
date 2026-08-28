# Project-scoped synchronization trust boundary

These Mermaid diagrams are the renderable trust/authority artifact for PZS-001.
They describe authority and custody; they do not claim that deferred runtime
implementation or end-to-end delivery is complete.

## Plaintext and mutation authority

```mermaid
flowchart LR
  subgraph LOCAL[Trusted local boundary]
    AGENT[Local agent / Themis skills\nplaintext + keys\nmutation authority]
    STORE[Project-local store\nplaintext while unlocked]
    CLIENT[Authorized client\nlocal decryption + materialization]
    AGENT <--> STORE
    AGENT -->|authorized plaintext projection| CLIENT
    CLIENT -->|local read model| UI[Read-only product UI]
  end

  subgraph CLOUD[Cloud orchestration boundary]
    API[API / worker / realtime\nauthorize + relay only]
    CIPHER[(Ciphertext envelopes\nallowlisted metadata)]
    API --> CIPHER
  end

  AGENT -->|ciphertext + safe metadata| API
  API -->|availability signal / ciphertext fetch| CLIENT
  API -.->|never decrypt, index plaintext, merge, or mutate domain state| AGENT
```

## Authority rules

- Local agents and skills retain plaintext and domain mutation authority.
- Cloud services may authenticate, authorize, persist ciphertext, assign
  non-sensitive cursor/revision metadata, and signal availability only.
- Cloud services do not receive project decryption keys and do not become the
  project authority.
- Clients decrypt and materialize locally after their local authorization
  decision; the cloud response is not proof of plaintext access.
