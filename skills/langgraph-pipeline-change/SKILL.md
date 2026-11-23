---
name: langgraph-pipeline-change
description: Use when adding, removing or rewiring a step in the LangSDK LangGraph answer pipeline (app/pipeline/graph.py) - for example a query rewrite, rerank or grade-and-retry node - so state, tracing, streaming, explanations, the UI diagram and tests stay in sync.
---

# LangSDK pipeline changes

- The graph is `guard → (route) → retrieve → generate → (rewrite → retrieve → generate, once, when `CORRECTIVE_RETRY` is on) → check` in `app/pipeline/graph.py`. The `rewrite` node is the worked example of a conditional loop: copy its pattern. Dependencies point one way: `interfaces → pipeline → models, retrieval, observability → config`. A new node must not import from `interfaces`.
- **Justify the node with evals first.** The original brief allows one optional grade → retry-once step only if evals show it helps. Run the baseline (`rag-eval-runner`) before writing code, and keep the node only if a slice improves beyond noise without raising latency p95 or tokens much.
- **Checklist for a new node, in order:**
  1. `State`: add typed fields with a short comment. `timings` is merged with `operator.or_`, so return `{"timings": {"<node>": _ms(start)}}` and never overwrite the dict.
  2. Node function: wrap model or search calls in `tracing.observation("<kebab-name>", "<type>", input=..., metadata={... prompt version, model, thresholds})` and set the output with `obs.update(...)`.
  3. `build_graph()`: edges or conditional edges. Any branch that ends early must set `answer`.
  4. `_step_status()`: a status for the node (`passed`, `skipped`, `warning`, `refused`, `empty`).
  5. `app/pipeline/explain.py`: a plain-language entry. `rag.py ask --details` and the UI show it.
  6. `run_config()`: any new prompt version or parameter, so evals and traces record it.
  7. The UI: `web/src/components/FlowDiagram.jsx` (and `HowItWorks.jsx` if the engine is new) lists the nodes. Rebuild with `cd web; npm run build`.
  8. README: the pipeline line, the trace tree under Tracing and, if relevant, the Guardrails table.
- **Streaming:** `stream()` yields `step`, `token` and `result` events. Tokens are forwarded only from the `generate` node (`meta["langgraph_node"]`). If a new node calls the LLM, its tokens must not leak into the answer stream. `stream()` must be consumed in one thread, because the tracing context is per thread.
- **Model calls:** use `get_llm()` and `arbitrate()` / `arbitrate_many()`. Batch several Arbiter questions about one state into one `arbitrate_many` request. Each extra call adds latency and cost, so say how many calls the change adds.
- **Tests:** extend `tests/test_graph.py` with its `fake` fixture. It monkeypatches `arbitrate`, `search` and `get_llm`, so the whole graph runs offline. Cover the new branch, the skipped path and the step order in `result["explanation"]`. `pytest` must pass with no network.
- Verify in the UI (`preview_start` with `search-ui`, port 8001): ask one question and check that the flow diagram and the "How this answer was produced" panel show the new step.
