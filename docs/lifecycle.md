# Lifecycle

## Task lifecycle

```text
received → classified → planned → delegated → in_progress →
verification → completed
```

## Ephemeral lifecycle

```text
proposed → evaluated → approved → active → verification → retired
```

Exec file `.cursor/agents/<id>.md` removed on retirement; spec retained in `docs/agents/ephemeral/`.

## Learning lifecycle

```text
signal → proposal (pending) → human review → accept/reject → durable doc (project-local)
```

## Agent promotion (ephemeral → permanent)

```text
candidate → architect → security → human → git review → registry update
```

No silent permanent promotion.
