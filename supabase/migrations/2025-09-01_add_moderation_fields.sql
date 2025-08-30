alter table jobs
  add column if not exists moderation_flag boolean,
  add column if not exists moderation_reason text,
  add column if not exists moderation_provider text,
  add column if not exists moderation_scores jsonb;
