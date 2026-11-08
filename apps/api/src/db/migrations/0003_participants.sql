CREATE TABLE "participant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nikount_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_nikount_id_id_unique" UNIQUE("nikount_id","id"),
	CONSTRAINT "participant_name_length" CHECK (char_length("participant"."name") between 1 and 40),
	CONSTRAINT "participant_sort_order_positive" CHECK ("participant"."sort_order" >= 0),
	CONSTRAINT "participant_version_positive" CHECK ("participant"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "admin_access" ADD COLUMN "participant_id" uuid;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_nikount_id_nikount_id_fk" FOREIGN KEY ("nikount_id") REFERENCES "public"."nikount"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_active_name_unique" ON "participant" USING btree ("nikount_id",lower("name")) WHERE "participant"."is_active";--> statement-breakpoint
ALTER TABLE "admin_access" ADD CONSTRAINT "admin_access_participant_same_nikount_fk" FOREIGN KEY ("nikount_id","participant_id") REFERENCES "public"."participant"("nikount_id","id") ON DELETE no action ON UPDATE no action;