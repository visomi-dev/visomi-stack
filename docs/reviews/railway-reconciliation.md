# Railway configuration reconciliation (VIS-33)

Audit and targeted correction: 2026-11-11, project `visomi-stack`, production, `web-gateway`. No credentials, variable values or customer data were copied into this report.

## Applied correction

The live gateway watch list omitted `apps/web/app`, `apps/web/realtime`, `assets/brand` and `libs/web/shared/observability`. The committed `.railway/railway.ts` already included them. The obsolete `theme.base.js` watch entry was also present only in production.

Updated only the service's `watchPatterns`, matching the committed list. Re-read the service afterward and ran another read-only IaC plan. The watch-list difference disappeared, and the plan returned no diagnostics. No source, variables, scaling, database settings, volume mounts, SMTP, Google configuration or tracing settings were changed. Nothing is staged.

Railway reports that these configuration changes take effect on the next deployment. A new source-triggered deployment has not yet been exercised, so matching files in the configuration is established; an end-to-end push/build demonstration is pending. The existing successful deployment is `02307a8a-e12d-4502-8c35-ee62af863d9f`.

## Differences intentionally retained

The remaining read-only plan has four safe updates and no creates, deletes or secret changes:

| Difference                                                                              | Decision and evidence                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway restart policy and sleep mode: unset live vs explicit ON_FAILURE / false in IaC | Retain live values for this correction. The gateway is healthy; deployment-default normalization is independent of watch coverage. The declared desired policy remains in source for a separately reviewed IaC apply. No restart or sleep behavior was changed. |
| Jaeger restart policy and sleep mode: unset live vs explicit ON_FAILURE / false in IaC  | Same decision. Avoid changing an independent operational service merely to normalize defaults.                                                                                                                                                                  |
| Redis named volume attachment metadata                                                  | Retain. `redis-volume` already exists in the configured region, is mounted live at `/data`, and has size 50000MB. The plan proposes named adoption metadata, not a new resource. No volume was recreated or remounted.                                          |
| PostgreSQL named volume attachment metadata                                             | Retain. `postgres-volume` already exists in the configured region, is mounted live at `/var/lib/postgresql/data`, and has size 50000MB. No volume was recreated or remounted.                                                                                   |

This is an explicit scoped decision to keep these differences, not a claim that the whole IaC plan is synchronized or applied. Any later full apply must re-plan, review the exact current diff and preserve resource identity and secrets.

## Verification

- Railway MCP inventory confirmed the project/environment and live services before mutation.
- `describe-service` verified the gateway source, watch patterns, successful deployment, variable names only, and no staged changes.
- `describe-service` independently verified the live PostgreSQL and Redis mounts.
- `railway config plan --json` before and after the update succeeded with no diagnostics. The CLI context matched the MCP project and production environment.
- The service update reported only `watchPatterns` as changed. The subsequent plan no longer proposes that change.
- Current plan artifacts are local under `/tmp/visomi-railway-plan*.json` and are not committed or shared because full plans can contain sensitive state.
