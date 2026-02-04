-- Enforce a single draft per class to prevent concurrent draft creation.
create unique index if not exists blueprints_single_draft_per_class
  on blueprints (class_id)
  where status = 'draft';
