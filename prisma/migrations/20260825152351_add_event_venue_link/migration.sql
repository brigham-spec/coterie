-- AlterTable
ALTER TABLE "events" ADD COLUMN     "venue_company_id" UUID,
ADD COLUMN     "venue_contact_id" UUID;

-- CreateIndex
CREATE INDEX "events_venue_company_id_idx" ON "events"("venue_company_id");

-- CreateIndex
CREATE INDEX "events_venue_contact_id_idx" ON "events"("venue_contact_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_company_id_fkey" FOREIGN KEY ("venue_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_contact_id_fkey" FOREIGN KEY ("venue_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
