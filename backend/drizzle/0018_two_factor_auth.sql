CREATE TABLE "recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "totp_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "totp_last_used_step" bigint;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "twofa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_code_user_hash_unique" ON "recovery_code" USING btree ("user_id","code_hash");--> statement-breakpoint
-- Sessions that existed before 2FA need no code, so they count as verified.
UPDATE "session" SET "twofa_verified_at" = "created_at";
