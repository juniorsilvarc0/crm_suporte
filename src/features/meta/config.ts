import { z } from "zod";

const graphVersionSchema = z.string().regex(/^v\d+\.\d+$/);

function enabled(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

export type MetaRuntimeConfig = {
  captureEnabled: boolean;
  enrichmentEnabled: boolean;
  capiEnabled: boolean;
  accessToken?: string;
  datasetId?: string;
  wabaId?: string;
  adAccountId?: string;
  graphApiVersion: string;
  testEventCode?: string;
  invalidTestEventEnvironment: boolean;
};

export function getMetaRuntimeConfig(): MetaRuntimeConfig {
  const parsedVersion = graphVersionSchema.safeParse(
    process.env.META_GRAPH_API_VERSION ?? "v25.0"
  );

  const rawTestEventCode = process.env.META_CAPI_TEST_EVENT_CODE;
  const testEnvironment = process.env.META_DEPLOY_ENV === "staging";

  return {
    captureEnabled: enabled(process.env.META_TRACKING_CAPTURE_ENABLED),
    enrichmentEnabled: enabled(process.env.META_ENRICHMENT_ENABLED),
    capiEnabled: enabled(process.env.META_CAPI_ENABLED),
    accessToken: process.env.META_ACCESS_TOKEN,
    datasetId: process.env.META_DATASET_ID,
    wabaId: process.env.META_WABA_ID,
    adAccountId: process.env.META_AD_ACCOUNT_ID,
    graphApiVersion: parsedVersion.success ? parsedVersion.data : "v25.0",
    testEventCode: testEnvironment ? rawTestEventCode : undefined,
    invalidTestEventEnvironment: Boolean(rawTestEventCode && !testEnvironment),
  };
}

export function validateMetaDispatchConfig(config: MetaRuntimeConfig): string[] {
  const missing: string[] = [];
  if ((config.enrichmentEnabled || config.capiEnabled) && !config.accessToken) {
    missing.push("META_ACCESS_TOKEN");
  }
  if (config.capiEnabled && !config.datasetId) missing.push("META_DATASET_ID");
  if (config.capiEnabled && !config.wabaId) missing.push("META_WABA_ID");
  if (config.invalidTestEventEnvironment) {
    missing.push("META_CAPI_TEST_EVENT_CODE_NOT_ALLOWED_OUTSIDE_STAGING");
  }
  return missing;
}
