-- AlterTable
ALTER TABLE "events" ADD COLUMN     "sponsor_invitee_id" UUID;

-- CreateIndex
CREATE INDEX "events_sponsor_invitee_id_idx" ON "events"("sponsor_invitee_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_sponsor_invitee_id_fkey" FOREIGN KEY ("sponsor_invitee_id") REFERENCES "event_invitees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
