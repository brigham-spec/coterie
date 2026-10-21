-- AlterTable
ALTER TABLE "action_items" ADD COLUMN     "email_message_id" UUID;

-- CreateIndex
CREATE INDEX "action_items_org_id_email_message_id_idx" ON "action_items"("org_id", "email_message_id");

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
