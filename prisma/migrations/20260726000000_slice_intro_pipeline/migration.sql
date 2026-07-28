-- S6a · Introductions pipeline. Two additive log fields the prototype's intro-log
-- form captures but the rebuild dropped; introductions already carry
-- tenant_isolation RLS (no policy change).
--   introductions.connection_type   taxonomy label for why the pair connects
--   introductions.headline          one-line "why" (the intro's talking-point)
-- Both non-null defaulting to '' so existing rows read as "unset", mirroring the
-- existing notes column.

ALTER TABLE "introductions"
  ADD COLUMN "connection_type" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "headline" TEXT NOT NULL DEFAULT '';
