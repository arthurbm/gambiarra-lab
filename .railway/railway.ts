// Infrastructure as code for the Railway project `bloco-de-frevo`: one block
// per service. See apps/frevo/README.md ("Deploy") for the whole procedure.
//
//   railway config plan                 # read only, shows the diff
//   railway config apply --yes          # applies (refuses anything destructive)
//
// Why one file and not a railway.json per service: Railway deprecated Config
// as Code (railway.json / railway.toml). New services cannot opt into it, and
// existing files stop being read on 2026-12-01. This file replaces it; Railway
// does not read it during a deploy, the CLI applies it.
//
// Needs the `railway` package (a root devDependency, for the import below),
// Node >= 22 on PATH (the CLI evaluates this file with
// `node --experimental-strip-types`) and a linked directory:
// `railway link -p 11908982-91b4-4956-bfe2-b68de2283d62 -e production`.
//
// Learned the hard way:
// - Do not write values that are already Railway's default (sleepApplication:
//   false, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10): the
//   plan drifts forever and every apply redeploys the service. A hub redeploy
//   wipes the Rooms.
// - Variables are managed: one that exists on a service and is not here gets
//   deleted on the next apply. Secrets are declared with preserve() and set by
//   `railway variable set --stdin`.
// - Do not run `railway config ...` behind `timeout`, `env` or `bunx`: the SDK
//   reads `$_` to find the CLI and fails with "requires Railway CLI 5.42.1".
import {
  defineRailway,
  github,
  preserve,
  project,
  service,
} from "railway/iac";

// Virginia: of the four regions, the closest to Recife.
const REGION = "us-east4-eqdc4a";
const HUB_PORT = "3000";
const MODELOS_PORT = "3002";
const MUNDO_PORT = "3001";
const ROOM_NAME = "bloco-de-frevo";

// Every service follows main on GitHub: a push that touches a service's watch
// patterns redeploys it. A redeploy of `mundo` drops the dynamic in memory, and
// one of `hub` wipes the Rooms, so do not merge to main during a presentation
// (or `railway service source disconnect --service <name>` before it).
const SOURCE = github("arthurbm/gambiarra-lab", { branch: "main" });
// What every image is built from, besides its own Dockerfile.
const SHARED = ["package.json", "bun.lock", "packages/**"];

// One replica in one region. Sleep (serverless) is off by default.
function deploy(healthcheckPath: string) {
  return {
    healthcheckPath,
    healthcheckTimeout: 120,
    multiRegionConfig: { [REGION]: { numReplicas: 1 } },
  };
}

export default defineRailway(() => {
  const hub = service("hub", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "deploy/frevo/hub.Dockerfile",
      // The hub rebuilds only when its own image changes. This file is not
      // in the list: the CLI applies it, a deploy does not read it.
      watchPatterns: ["deploy/frevo/hub.Dockerfile", "bun.lock"],
    },
    source: SOURCE,
    deploy: deploy("/v1/health"),
    env: {
      // The hub ignores PORT; CMD passes HUB_PORT by flag. PORT repeats it
      // only because Railway knocks on PORT for the healthcheck.
      HUB_PORT,
      PORT: HUB_PORT,
    },
    // No `domains` and no `railway domain`: the hub has no auth and never
    // leaves the private network.
  });

  // `${{...}}` is Railway's reference syntax, resolved on its side.
  // It becomes http://hub.railway.internal:3000.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Railway's reference syntax, not a JS template.
  const hubUrl = "http://${{hub.RAILWAY_PRIVATE_DOMAIN}}:${{hub.HUB_PORT}}";

  const modelos = service("modelos", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "deploy/frevo/modelos.Dockerfile",
      watchPatterns: [
        "apps/frevo/**",
        "deploy/frevo/modelos.Dockerfile",
        "deploy/frevo/secrets-entrypoint.sh",
        ...SHARED,
      ],
    },
    source: SOURCE,
    // 200 while the process runs; the body says how many participants joined.
    deploy: deploy("/health"),
    env: {
      GAMBI_HUB_URL: hubUrl,
      FREVO_ROOM_NAME: ROOM_NAME,
      FREVO_MODEL_HOST_PORT: MODELOS_PORT,
      PORT: MODELOS_PORT,
      // FREVO_MODELS is left out: the default is the twelve participants of
      // apps/frevo/src/models/catalog.ts, five models.
      // Set from the local file by the CLI. The only service with this key.
      OPENROUTER_API_KEY: preserve(),
    },
    // No domain: private network only.
  });

  const mundo = service("mundo", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "deploy/frevo/mundo.Dockerfile",
      watchPatterns: [
        "apps/frevo/**",
        "apps/frevo-web/**",
        "deploy/frevo/mundo.Dockerfile",
        "deploy/frevo/secrets-entrypoint.sh",
        ...SHARED,
      ],
    },
    source: SOURCE,
    deploy: deploy("/health"),
    env: {
      GAMBI_HUB_URL: hubUrl,
      FREVO_ROOM_NAME: ROOM_NAME,
      PORT: MUNDO_PORT,
      // The QR's address. The domain generated by `railway domain` is not in
      // this file; the reference resolves to it.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Railway's reference syntax, not a JS template.
      FREVO_PUBLIC_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      // Estimated session spending that puts every boneco on autopilot.
      FREVO_BUDGET_USD: "1",
      // No boneco without a person: one would join a bloco and parade.
      FREVO_BONECOS: "0",
      FREVO_ADMIN_SECRET: preserve(),
      FAL_KEY: preserve(),
    },
    // The only public service: `railway domain --service mundo --port 3001`.
  });

  return project("bloco-de-frevo", { resources: [hub, modelos, mundo] });
});
