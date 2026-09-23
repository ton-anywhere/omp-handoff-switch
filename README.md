# OMP Handoff Switch

Temporarily uses a configured OMP model role for interactive `/handoff` and non-speculative automatic handoff, then restores the previous model. Native `/handoff` keeps its focus argument.

Install from this checkout with `omp plugin link /path/to/checkout`, or from a published Git tag with `omp plugin install 'github:ton-anywhere/omp-handoff-switch#TAG'`. Remove any directly loaded copy under `~/.omp/agent/extensions/` first to avoid duplicate listeners. Restart OMP after installing or changing the extension. In `handoff-switch.yml`, set `handoff.model` to an existing OMP model role **without** `@`:

```yml
handoff:
  model: smol
```

Set `compaction.asyncEnabled: false` in OMP settings; speculative handoffs may generate before the model switch. Restart OMP after editing `handoff-switch.yml` (read at initialization).

Run checks from this checkout with `bun run test`.

**Best effort:** cancelled or failed manual handoffs may leave the handoff model selected; restoration does not recover thinking level if switching models clamped it. Verify the selected model after a failed handoff.
