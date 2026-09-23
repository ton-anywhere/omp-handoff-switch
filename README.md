# OMP Handoff Switch

This is an [OMP](https://omp.sh/) extension that enables model role configuration for handoff compactions. It works for interactive `/handoff` and non-speculative automatic handoff.

It works by updating the active model to `handoff.model` during a handoff, then restoring the previous model afterward.

## Install & Usage

1. Install from GitHub

```bash
omp plugin install 'github:ton-anywhere/omp-handoff-switch'
```

2. On first load, the extension creates `handoff-switch.yml` beside the active profile's `config.yml`. Edit `handoff.model` to select an existing OMP model role **without** `@`. The default profile uses `~/.omp/agent/handoff-switch.yml`; a named profile normally uses `~/.omp/profiles/<name>/agent/handoff-switch.yml`:

```yml
handoff:
  model: smol
```

3. In the active profile's `config.yml`, set

```yml
compaction:
  enabled: true
  asyncEnabled: false
```
4. (optional) For *auto-handoff*, check whether handoff is available in `compaction.methodOrder`.

```yml
compaction:
  methodOrder:
    - remote
    - handoff
    - shake
    - soft
``` 

5. Restart OMP or `/reload-plugins`.

The next `/handoff` or automatic handoff will be processed by the model configured in `handoff.model` (default: **smol**).

## Commands

Run checks from this checkout with `bun run test`.

Verify install with `omp plugin list`

Uninstall with `omp plugin uninstall @ton-anywhere/omp-handoff-switch`.

## Limitations

**Best effort:** Cancelled or failed manual handoffs may leave the handoff model selected; speculative handoffs can switch the model while that model is being used.

---

## License

MIT © 2026 [Ton Anywhere](https://github.com/ton-anywhere)
