CREATE TABLE IF NOT EXISTS app_documents (
  path TEXT PRIMARY KEY,
  collection_path TEXT NOT NULL,
  document_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_documents_collection_path_idx
  ON app_documents (collection_path);
