// Load .env (DATABASE_URL) into process.env before any test module imports the
// Prisma client, which reads the connection string at construction time.
import "dotenv/config";
