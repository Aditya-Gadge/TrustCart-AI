# TrustCart AI demo script (under 3 minutes)

**Target runtime: 2 minutes 45 seconds.** This script requires a reachable
PostgreSQL database with synthetic orders, Gemini configuration if you want to
show an AI answer, and working PayPal Sandbox credentials plus a Sandbox buyer
for a real checkout. Do not present a mocked checkout as a real payment.

| Time | Screen/action | Narration |
|---|---|---|
| 0:00–0:20 | Dashboard (`/`) | “TrustCart gives merchants a single place to inspect order risk, record human review decisions, and verify Sandbox payments. These dashboard totals come from stored database records.” |
| 0:20–0:45 | Orders (`/orders`): select High risk and open a pending order | “This queue is searchable and filterable. The risk band is a deterministic demo heuristic—not a validated fraud prediction.” |
| 0:45–1:15 | Investigation page: show score, rule reasons, evidence, and rule version | “Each signal explains the exact evidence and threshold. The score is reproducible and versioned; the AI does not choose the score or decide whether to accept the order.” |
| 1:15–1:40 | Copilot (`/copilot`): ask about this order or its risk reasons | “The copilot reads stored order data through fixed, read-only tools. Citations are checked against retrieved records. If Gemini is unavailable, the UI reports that and offers a stored-data fallback.” |
| 1:40–2:00 | Return to the order; choose Approve and enter a reason | “A merchant makes the decision. The server validates the transition and reason, checks for concurrent edits, recalculates the risk snapshot, and records an audit event.” |
| 2:00–2:35 | PayPal Sandbox section: pay with the Sandbox buyer | “Checkout is Sandbox-only. The server derives amount and currency from the order and verifies PayPal's capture response before recording a verified payment.” |
| 2:35–2:45 | Refresh and show Payments history / audit timeline | “The final state is shown from the database as verified after server-side confirmation—not from the browser approval callback.” |

## Presenter checks before recording

- Confirm the database contains only synthetic data and a pending order with
  meaningful rule evidence.
- Confirm Gemini quota/provider availability; otherwise use the disclosed
  stored-data fallback and do not claim a Gemini-generated answer.
- Verify the PayPal buttons use the Sandbox app and that the Sandbox buyer can
  complete payment on this origin.
- If testing with Playwright interception, label it **MOCKED** and do not
  claim that a PayPal payment occurred.
- Make no deployment, video, real-payment, or fraud-accuracy claims that have
  not been independently verified.
