/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CASE_ID?: string;
  readonly VITE_NEXUS_URL?: string;
  readonly VITE_ASPEN_GROVE_PATH?: string;
  readonly VITE_GEMINI_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
