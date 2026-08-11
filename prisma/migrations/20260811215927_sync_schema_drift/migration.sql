-- DropIndex
DROP INDEX "projects_developer_member_id_idx";

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "done_action_items" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "event_invitees" ADD COLUMN     "outreach_draft" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outreach_sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "outreach_status" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "news_items" ADD COLUMN     "key_facts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "note" TEXT;
