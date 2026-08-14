-- AlterTable
ALTER TABLE "introductions" ADD COLUMN     "owner_user_id" UUID;

-- AlterTable
ALTER TABLE "membership_proposals" ADD COLUMN     "owner_user_id" UUID;

-- AddForeignKey
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_proposals" ADD CONSTRAINT "membership_proposals_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
