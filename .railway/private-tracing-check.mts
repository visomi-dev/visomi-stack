import { preserve, service } from 'railway/iac';

// Keep the existing synthetic receiver check when applying this whole-environment configuration.
export const privateTracingCheck = service('pr9-private-tracing-check', {
  root: '/',
  source: {
    repo: 'visomi-dev/visomi-stack',
    branch: 'codex/ci-railway',
    commitSha: 'cdf4a386e4ea050109f8e6a29ca76241f5831a8a',
    rootDirectory: '/',
  },
  build: {
    builder: 'DOCKERFILE',
    buildEnvironment: 'V3',
    dockerfilePath: 'Dockerfile',
  },
  deploy: {
    startCommand:
      'node --input-type=module -e \'import { setTimeout as delay } from "node:timers/promises";\nawait import("./dist/apps/web/gateway/main.js");\nconst origin = "http://127.0.0.1:8080";\nlet ready = false;\nfor (let attempt=0; attempt<100; attempt++) {\n  try { const response=await fetch(origin+"/api/"); await response.text(); if(response.ok) { ready=true; break; } } catch {}\n  await delay(100);\n}\nif (!ready) { process.stderr.write("tracing_probe_startup_failed\\n"); process.exit(1); }\nconst marker="SYNTHETIC_PRIVATE_RAILWAY_71d3";\nfor (const [path,method,status] of [["/api/", "GET",200],["/missing/"+marker+"?token="+marker,"POST",404],["/api/auth/session?secret="+marker,"GET",503]]) {\n const response=await fetch(origin+path,{method,headers:{"content-type":"application/json",authorization:"Bearer "+marker,cookie:"session="+marker,"x-request-id":marker,"user-agent":marker,"x-forwarded-for":"192.0.2.100",traceparent:"00-"+"f".repeat(32)+"-"+"f".repeat(16)+"-01",tracestate:"private="+marker,baggage:"private="+marker},...(method==="POST"?{body:JSON.stringify({customer:marker})}:{})});\n await response.text();\n if(response.status!==status) { process.stderr.write("tracing_probe_response_failed\\n"); process.exit(1); }\n}\nconst telemetry=globalThis[Symbol.for("visomi-stack.observability.v1")]?.runtime;\nif(!telemetry) { process.stderr.write("tracing_probe_runtime_failed\\n"); process.exit(1); }\nconst result=await telemetry.runJob(undefined, async()=>"completed");\nconst failure=new Error(marker);\nlet preserved=false;\ntry { await telemetry.runJob(undefined, async()=>{throw failure;}); } catch(error) { preserved=error===failure; }\nif(result!=="completed" || !preserved) { process.stderr.write("tracing_probe_job_failed\\n"); process.exit(1); }\nawait delay(1200);\nprocess.stdout.write("tracing_probe_completed\\n");\nprocess.kill(process.pid,"SIGTERM");\'',
    limitOverride: {
      containers: {
        cpu: 0.5,
        memoryBytes: 500000000,
      },
    },
    restartPolicyType: 'NEVER',
    useLegacyStacker: false,
    ipv6EgressEnabled: false,
    runtime: 'V2',
    multiRegionConfig: {
      'us-east4-eqdc4a': {
        numReplicas: 1,
      },
    },
    drainingSeconds: 10,
  },
  tracing: {
    enabled: true,
    autoInstrumentation: false,
  },
  env: {
    APP_NAME: preserve(),
    ASTRO_TELEMETRY_DISABLED: preserve(),
    HOST: preserve(),
    NODE_ENV: preserve(),
    OTEL_LOGS_EXPORTER: preserve(),
    OTEL_METRICS_EXPORTER: preserve(),
    PORT: preserve(),
    VISOMI_RAILWAY_TRACING: preserve(),
  },
});
