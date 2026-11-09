CREATE TABLE "user_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_connection_distinct_users" CHECK ("user_connection"."requester_id" <> "user_connection"."addressee_id"),
	CONSTRAINT "user_connection_valid_status" CHECK ("user_connection"."status" IN ('pending', 'accepted'))
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_connection" ADD CONSTRAINT "user_connection_requester_id_app_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connection" ADD CONSTRAINT "user_connection_addressee_id_app_user_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_connection_pair_unique" ON "user_connection" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "user_connection_requester_idx" ON "user_connection" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "user_connection_addressee_idx" ON "user_connection" USING btree ("addressee_id");